import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

const CONSIGNES = `Tu lis des photos de cartes de prix (étiquettes de tablette) prises en magasin au Québec.
Pour CHAQUE carte de prix lisible sur la photo, extrais les champs demandés.
Règles :
- N'invente rien. Un champ illisible ou absent = null.
- Les prix sont des nombres en dollars (3,99 $ -> 3.99 ; 99¢ -> 0.99).
- prix_regulier : prix courant à l'unité. S'il n'y a qu'un seul prix et aucune mention de rabais, c'est le prix régulier.
- Offre multiple « 2 pour 5,00 $ » ou « 2/5 $ » : prix_promo = 5.00 (total de l'offre) et promo_quantite = 2.
- Prix promo simple : prix_promo = le prix en rabais, promo_quantite = 1.
- promo_texte : le libellé de l'offre tel qu'écrit (ex. « Économisez 1,00 $ », « Prix membre »).
- Dates au format AAAA-MM-JJ. Si l'année n'est pas imprimée, utilise celle de la date du jour fournie.
- cup : uniquement les chiffres du code-barres (CUP/UPC). code_article : numéro d'article ou SKU interne.
- prix_unitaire : le prix par unité de mesure tel qu'affiché (ex. « 1,25 $ / 100 g »).
- confiance : « haute », « moyenne » ou « basse » selon la lisibilité.
Si aucune carte de prix n'est lisible, renvoie une liste vide.`;

const texte = { type: ["string", "null"] };
const nombre = { type: ["number", "null"] };

const OUTIL: Anthropic.Tool = {
  name: "enregistrer_cartes",
  description: "Enregistre les cartes de prix lues sur la photo.",
  input_schema: {
    type: "object",
    properties: {
      cartes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            produit: texte,
            marque: texte,
            format: texte,
            prix_regulier: nombre,
            prix_promo: nombre,
            promo_quantite: { type: ["integer", "null"] },
            promo_texte: texte,
            date_debut: texte,
            date_fin: texte,
            cup: texte,
            code_article: texte,
            prix_unitaire: texte,
            confiance: { type: "string", enum: ["haute", "moyenne", "basse"] },
          },
          required: ["produit", "prix_regulier", "confiance"],
        },
      },
    },
    required: ["cartes"],
  },
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export async function POST(req: Request) {
  const supabase = supabaseServer();
  if (!supabase) return NextResponse.json({ error: "Configuration Supabase manquante." }, { status: 500 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY manquante sur le serveur." }, { status: 500 });
  }

  const { image, visiteId } = (await req.json().catch(() => ({}))) as { image?: string; visiteId?: string };
  if (!image || !visiteId) return NextResponse.json({ error: "Photo ou visite manquante." }, { status: 400 });

  const { data: visite } = await supabase.from("visites").select("id").eq("id", visiteId).maybeSingle();
  if (!visite) return NextResponse.json({ error: "Visite introuvable." }, { status: 404 });

  const base64 = image.replace(/^data:image\/\w+;base64,/, "");

  let cartes: Record<string, unknown>[] = [];
  try {
    const anthropic = new Anthropic();
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: CONSIGNES,
      tools: [OUTIL],
      tool_choice: { type: "tool", name: OUTIL.name },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
            { type: "text", text: `Date du jour : ${new Date().toISOString().slice(0, 10)}. Extrais les cartes de prix.` },
          ],
        },
      ],
    });
    const bloc = msg.content.find((b) => b.type === "tool_use");
    const input = bloc && bloc.type === "tool_use" ? (bloc.input as { cartes?: unknown }) : null;
    if (Array.isArray(input?.cartes)) cartes = input.cartes as Record<string, unknown>[];
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur inconnue";
    return NextResponse.json({ error: `Lecture de la photo impossible : ${message}` }, { status: 502 });
  }

  if (cartes.length === 0) {
    return NextResponse.json({ scans: [], message: "Aucune carte de prix lisible sur cette photo." });
  }

  // Photo conservée pour pouvoir vérifier une lecture douteuse (non bloquant si l'envoi échoue).
  let photoPath: string | null = `cartes/${crypto.randomUUID()}.jpg`;
  const { error: upErr } = await supabase.storage
    .from("photos")
    .upload(photoPath, Buffer.from(base64, "base64"), { contentType: "image/jpeg" });
  if (upErr) photoPath = null;

  const lignes = cartes.map((c) => ({
    visite_id: visiteId,
    produit: str(c.produit),
    marque: str(c.marque),
    format: str(c.format),
    prix_regulier: num(c.prix_regulier),
    prix_promo: num(c.prix_promo),
    promo_quantite: typeof c.promo_quantite === "number" ? Math.trunc(c.promo_quantite) : null,
    promo_texte: str(c.promo_texte),
    date_debut: date(c.date_debut),
    date_fin: date(c.date_fin),
    cup: str(c.cup)?.replace(/\D/g, "") || null,
    code_article: str(c.code_article),
    prix_unitaire: str(c.prix_unitaire),
    confiance: str(c.confiance),
    photo_path: photoPath,
  }));

  const { data, error } = await supabase.from("scans").insert(lignes).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ scans: data });
}
