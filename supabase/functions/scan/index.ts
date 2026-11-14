// Fonction Edge : lit une photo de cartes de prix avec Claude Vision et enregistre les prix.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-jeton",
};
const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";
const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, "Content-Type": "application/json" } });

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
- categorie : une seule parmi : Fruits et légumes, Viandes et poissons, Produits laitiers et œufs, Boulangerie, Épicerie, Surgelés, Boissons, Collations et confiseries, Prêt-à-manger et charcuterie, Santé et beauté, Entretien ménager, Bébé, Animaux, Autre.
- cle_produit : identifiant normalisé pour reconnaître le même produit d'un magasin à l'autre : marque, nom générique et format, en minuscules sans accents (ex. « lactantia beurre sale 454 g »).
Si aucune carte de prix n'est lisible, renvoie une liste vide.`;

const texte = { type: ["string", "null"] };
const nombre = { type: ["number", "null"] };
const OUTIL = {
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
            produit: texte, marque: texte, format: texte,
            prix_regulier: nombre, prix_promo: nombre,
            promo_quantite: { type: ["integer", "null"] },
            promo_texte: texte, date_debut: texte, date_fin: texte,
            cup: texte, code_article: texte, prix_unitaire: texte,
            categorie: texte, cle_produit: texte,
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: acces } = await sb.rpc("verifier_jeton", { jeton: req.headers.get("x-jeton") ?? "" });
    if (!acces) return json({ error: "Accès refusé. Entre ton code à nouveau.", acces: false });
    const { image, visiteId } = await req.json().catch(() => ({}));
    if (!image || !visiteId) return json({ error: "Photo ou visite manquante." });

    const { data: visite } = await sb.from("visites").select("id").eq("id", visiteId).maybeSingle();
    if (!visite) return json({ error: "Visite introuvable." });

    const { data: cle } = await sb.rpc("lire_cle_claude");
    if (!cle) return json({ error: "La clé API Claude n'est pas encore enregistrée." });

    const base64 = String(image).replace(/^data:image\/\w+;base64,/, "");
    const rep = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": cle, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: CONSIGNES,
        tools: [OUTIL],
        tool_choice: { type: "tool", name: OUTIL.name },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
            { type: "text", text: `Date du jour : ${new Date().toISOString().slice(0, 10)}. Extrais les cartes de prix.` },
          ],
        }],
      }),
    });
    const msg = await rep.json();
    if (!rep.ok) return json({ error: `Lecture de la photo impossible : ${msg?.error?.message ?? rep.status}` });

    // deno-lint-ignore no-explicit-any
    const bloc = (msg.content ?? []).find((b: any) => b.type === "tool_use");
    const cartes: Record<string, unknown>[] = Array.isArray(bloc?.input?.cartes) ? bloc.input.cartes : [];
    if (!cartes.length) return json({ scans: [], message: "Aucune carte de prix lisible sur cette photo." });

    // Photo conservée pour pouvoir vérifier une lecture douteuse (non bloquant si l'envoi échoue).
    let photoPath: string | null = `cartes/${crypto.randomUUID()}.jpg`;
    const octets = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const { error: upErr } = await sb.storage.from("photos").upload(photoPath, octets, { contentType: "image/jpeg" });
    if (upErr) photoPath = null;

    const lignes = cartes.map((c) => ({
      visite_id: visiteId,
      produit: str(c.produit), marque: str(c.marque), format: str(c.format),
      prix_regulier: num(c.prix_regulier), prix_promo: num(c.prix_promo),
      promo_quantite: typeof c.promo_quantite === "number" ? Math.trunc(c.promo_quantite) : null,
      promo_texte: str(c.promo_texte), date_debut: date(c.date_debut), date_fin: date(c.date_fin),
      cup: str(c.cup)?.replace(/\D/g, "") || null,
      code_article: str(c.code_article), prix_unitaire: str(c.prix_unitaire),
      categorie: str(c.categorie), cle_produit: str(c.cle_produit)?.toLowerCase() ?? null,
      confiance: str(c.confiance), photo_path: photoPath,
    }));
    const { data, error } = await sb.from("scans").insert(lignes).select();
    if (error) return json({ error: error.message });
    return json({ scans: data });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Erreur inconnue" });
  }
});
