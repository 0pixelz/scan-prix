import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-haiku-5-5";

const CHAMPS = {
  produit: { type: "string" },
  marque: { type: "string" },
  format: { type: "string" },
  prix_regulier: { type: "number" },
  prix_promo: { type: "number", description: "Prix total de l'offre (5.00 pour « 2 pour 5 $ »)" },
  promo_quantite: { type: "integer", description: "Quantité de l'offre (2 pour « 2 pour 5 $ »)" },
  promo_texte: { type: "string" },
  date_debut: { type: "string", description: "AAAA-MM-JJ" },
  date_fin: { type: "string", description: "AAAA-MM-JJ" },
  cup: { type: "string" },
  code_article: { type: "string" },
  prix_unitaire: { type: "string" },
  notes: { type: "string" },
};
const NOMS_CHAMPS = Object.keys(CHAMPS);

const OUTILS: Anthropic.Tool[] = [
  {
    name: "lister_visites",
    description: "Liste les visites en magasin (bannière, magasin, date) avec leur identifiant.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "chercher_prix",
    description:
      "Cherche les prix scannés. Tous les filtres sont optionnels. Sans visite_id, cherche dans toutes les visites.",
    input_schema: {
      type: "object",
      properties: {
        texte: { type: "string", description: "Mot à chercher dans le produit, la marque ou le code" },
        visite_id: { type: "string" },
        banniere: { type: "string" },
        promo_seulement: { type: "boolean" },
        a_verifier_seulement: { type: "boolean", description: "Lectures de confiance moyenne ou basse" },
        limite: { type: "integer", description: "Maximum de lignes (défaut 100, max 300)" },
      },
    },
  },
  {
    name: "ajouter_prix",
    description: "Ajoute un prix à la main dans une visite (la visite en cours par défaut).",
    input_schema: {
      type: "object",
      properties: { visite_id: { type: "string" }, ...CHAMPS },
      required: ["produit", "prix_regulier"],
    },
  },
  {
    name: "modifier_prix",
    description: "Corrige un prix existant. Ne passer que les champs à changer.",
    input_schema: { type: "object", properties: { id: { type: "string" }, ...CHAMPS }, required: ["id"] },
  },
  {
    name: "supprimer_prix",
    description: "Supprime un prix. À n'utiliser qu'après une confirmation explicite de l'utilisateur.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
];

type Msg = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  const supabase = supabaseServer();
  if (!supabase) return NextResponse.json({ error: "Configuration Supabase manquante." }, { status: 500 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY manquante sur le serveur." }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { messages?: Msg[]; visiteId?: string };
  const historique = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20);
  if (!historique.length) return NextResponse.json({ error: "Message vide." }, { status: 400 });

  let visiteTexte = "aucune";
  if (body.visiteId) {
    const { data: v } = await supabase.from("visites").select("*").eq("id", body.visiteId).maybeSingle();
    if (v) visiteTexte = `${v.banniere}${v.magasin ? `, ${v.magasin}` : ""}, ${v.date_visite} (id ${v.id})`;
  }

  const systeme = `Tu es l'assistant de Scan Prix, une app personnelle pour relever des cartes de prix en magasin au Québec.
Tu aides à consulter, comparer, corriger et résumer les prix scannés, à l'aide des outils fournis.
Date du jour : ${new Date().toISOString().slice(0, 10)}. Visite en cours : ${visiteTexte}.
Règles :
- Réponds en français, de façon brève et directe. Texte simple : pas de markdown, pas d'emoji. Pour une liste, une ligne par élément commençant par « - ».
- Prix au format québécois (3,99 $). Pour une offre multiple, donne aussi le prix à l'unité.
- Appuie-toi toujours sur les outils pour les données ; n'invente jamais un prix.
- Par défaut, les questions portent sur la visite en cours. Cherche dans toutes les visites pour les comparaisons.
- Avant de supprimer, demande une confirmation. Après une modification, confirme en une phrase ce qui a changé.`;

  let modifie = false;

  async function executer(nom: string, a: Record<string, unknown>): Promise<unknown> {
    const sb = supabase!;
    const champs = () => Object.fromEntries(NOMS_CHAMPS.filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
    switch (nom) {
      case "lister_visites": {
        const { data, error } = await sb.from("visites").select("id, banniere, magasin, date_visite").order("date_visite", { ascending: false }).limit(100);
        return error ? { erreur: error.message } : data;
      }
      case "chercher_prix": {
        let q = sb
          .from("scans")
          .select("id, produit, marque, format, prix_regulier, prix_promo, promo_quantite, promo_texte, date_debut, date_fin, cup, code_article, prix_unitaire, confiance, notes, visites!inner(id, banniere, magasin, date_visite)")
          .order("created_at", { ascending: false })
          .limit(Math.min(Number(a.limite) || 100, 300));
        if (typeof a.visite_id === "string") q = q.eq("visite_id", a.visite_id);
        if (typeof a.banniere === "string") q = q.ilike("visites.banniere", `%${a.banniere}%`);
        if (a.promo_seulement) q = q.not("prix_promo", "is", null);
        if (a.a_verifier_seulement) q = q.in("confiance", ["moyenne", "basse"]);
        if (typeof a.texte === "string") {
          const t = a.texte.replace(/[^\p{L}\p{N} .'-]/gu, " ").trim();
          if (t) q = q.or(`produit.ilike.%${t}%,marque.ilike.%${t}%,cup.ilike.%${t}%,code_article.ilike.%${t}%`);
        }
        const { data, error } = await q;
        return error ? { erreur: error.message } : data;
      }
      case "ajouter_prix": {
        const visite_id = typeof a.visite_id === "string" ? a.visite_id : body.visiteId;
        if (!visite_id) return { erreur: "Aucune visite en cours." };
        const { data, error } = await sb.from("scans").insert({ ...champs(), visite_id, confiance: "haute" }).select("id").single();
        if (error) return { erreur: error.message };
        modifie = true;
        return { ok: true, id: data.id };
      }
      case "modifier_prix": {
        const maj = champs();
        if (!Object.keys(maj).length) return { erreur: "Aucun champ à modifier." };
        const { data, error } = await sb.from("scans").update({ ...maj, confiance: "haute" }).eq("id", String(a.id)).select("id");
        if (error) return { erreur: error.message };
        if (!data?.length) return { erreur: "Prix introuvable." };
        modifie = true;
        return { ok: true };
      }
      case "supprimer_prix": {
        const { data, error } = await sb.from("scans").delete().eq("id", String(a.id)).select("id");
        if (error) return { erreur: error.message };
        if (!data?.length) return { erreur: "Prix introuvable." };
        modifie = true;
        return { ok: true };
      }
      default:
        return { erreur: "Outil inconnu." };
    }
  }

  try {
    const anthropic = new Anthropic();
    const messages: Anthropic.MessageParam[] = historique.map((m) => ({ role: m.role, content: m.content }));

    for (let tour = 0; tour < 8; tour++) {
      const rep = await anthropic.messages.create({ model: MODEL, max_tokens: 1500, system: systeme, tools: OUTILS, messages });
      if (rep.stop_reason !== "tool_use") {
        const texte = rep.content.filter((b) => b.type === "text").map((b) => (b.type === "text" ? b.text : "")).join("\n").trim();
        return NextResponse.json({ reponse: texte || "Je n'ai pas de réponse.", modifie });
      }
      messages.push({ role: "assistant", content: rep.content });
      const resultats: Anthropic.ToolResultBlockParam[] = [];
      for (const b of rep.content) {
        if (b.type !== "tool_use") continue;
        const r = await executer(b.name, (b.input ?? {}) as Record<string, unknown>);
        resultats.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(r) });
      }
      messages.push({ role: "user", content: resultats });
    }
    return NextResponse.json({ reponse: "La demande est trop longue à traiter. Essaie de la préciser.", modifie });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur inconnue";
    return NextResponse.json({ error: `Assistant indisponible : ${message}` }, { status: 502 });
  }
}
