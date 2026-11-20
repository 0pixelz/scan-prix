// Fonction Edge : lit une photo de cartes de prix avec Claude Vision et enregistre les prix.
// Si Claude ne répond pas (crédits épuisés, panne), la photo est lue par un service de secours (Gemini)
// quand sa clé est enregistrée.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-jeton",
};
const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";
// Modèles du service de secours, essayés dans l'ordre (le suivant sert si le premier est refusé ou saturé).
const MODELES_SECOURS = (Deno.env.get("GEMINI_MODELS") || "gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite").split(",").map((m) => m.trim()).filter(Boolean);
const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, "Content-Type": "application/json" } });

const INTRO_CARTE = `Tu lis des photos de cartes de prix (étiquettes de tablette) prises en magasin au Québec.
Pour CHAQUE carte de prix lisible sur la photo, extrais les champs demandés.`;

// Page de circulaire : chaque offre de la page est traitée comme une carte de prix.
const INTRO_CIRCULAIRE = `Tu lis la photo ou la capture d'une page de circulaire d'épicerie au Québec.
Pour CHAQUE offre lisible sur la page (un produit avec son prix), extrais les champs demandés, comme si c'était une carte de prix.
Le prix annoncé dans la circulaire est le prix en rabais (prix_promo) ; prix_regulier est le prix courant seulement s'il est imprimé, sinon null.
Les dates de validité de la circulaire, si elles sont visibles, s'appliquent à toutes les offres de la page.`;

const REGLES = `Règles :
- N'invente rien. Un champ illisible ou absent = null.
- Les prix sont des nombres en dollars (3,99 $ -> 3.99 ; 99¢ -> 0.99).
- prix_regulier : prix courant à l'unité. S'il n'y a qu'un seul prix et aucune mention de rabais, c'est le prix régulier.
- Offre multiple « 2 pour 5,00 $ » ou « 2/5 $ » : prix_promo = 5.00 (total de l'offre) et promo_quantite = 2.
- Prix promo simple : prix_promo = le prix en rabais, promo_quantite = 1.
- promo_texte : le libellé de l'offre tel qu'écrit (ex. « Économisez 1,00 $ », « Prix membre »).
- prix_membre : true si le prix en rabais (ou le prix affiché) est réservé aux membres d'un programme ou d'une carte (« Prix membre », « Membres Moi », « Scène+ », « PC Optimum », carte du magasin), sinon false.
- points : nombre de points de fidélité offerts à l'achat (« 500 points » -> 500), sinon null.
- points_details : le programme et la condition tels qu'écrits (ex. « 1 000 points Moi à l'achat de 2 »), sinon null.
- Dates au format AAAA-MM-JJ. Si l'année n'est pas imprimée, utilise celle de la date du jour fournie.
- cup : uniquement les chiffres du code-barres (CUP/UPC). code_article : numéro d'article ou SKU interne.
- prix_unitaire : le prix par unité de mesure tel qu'affiché (ex. « 1,25 $ / 100 g »).
- confiance : « haute », « moyenne » ou « basse » selon la lisibilité.
- categorie : une seule parmi : Fruits et légumes, Viandes et poissons, Produits laitiers et œufs, Boulangerie, Épicerie, Surgelés, Boissons, Collations et confiseries, Prêt-à-manger et charcuterie, Santé et beauté, Entretien ménager, Bébé, Animaux, Autre.
- icone : le type de produit, une seule valeur parmi : pain, viennoiserie, craquelin, biscuit, cereales, pates_riz, farine_sucre, lait, yogourt, fromage, beurre, oeufs, viande, volaille, charcuterie, poisson, fruits_de_mer, fruits, legumes, salade, conserve, soupe, sauce_condiment, huile, epices, tartinade, cafe, the, jus, boisson_gazeuse, eau, biere, vin, croustilles, noix, bonbon, chocolat, dessert, creme_glacee, surgele, pizza, repas_prepare, bebe, animaux, nettoyage, lessive, papier, hygiene, sante, autre.
- cle_produit : identifiant normalisé pour reconnaître le même produit d'un magasin à l'autre : marque, nom générique et format, en minuscules sans accents (ex. « lactantia beurre sale 454 g »).`;

const FIN_CLAUDE = `Réponds toujours en appelant l'outil enregistrer_cartes, une seule fois, avec toutes les cartes lues.
Si rien n'est lisible, appelle-le avec une liste vide.`;

const FIN_SECOURS = `Réponds uniquement avec un objet JSON de la forme {"cartes": [ ... ]}, une entrée par carte lue, avec exactement ces champs :
produit, marque, format, prix_regulier, prix_promo, promo_quantite, promo_texte, date_debut, date_fin, prix_membre, points, points_details, cup, code_article, prix_unitaire, categorie, icone, cle_produit, confiance.
Si rien n'est lisible, réponds {"cartes": []}.`;

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
            prix_membre: { type: ["boolean", "null"] }, points: { type: ["integer", "null"] }, points_details: texte,
            cup: texte, code_article: texte, prix_unitaire: texte,
            categorie: texte, icone: texte, cle_produit: texte,
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

type Lecture = { cartes: Record<string, unknown>[]; modele: string; entree: number; sortie: number };
const consigne = (circulaire: boolean) =>
  `Date du jour : ${new Date().toISOString().slice(0, 10)}. ${circulaire ? "Extrais toutes les offres de cette page de circulaire." : "Extrais les cartes de prix."}`;

async function lireClaude(cle: string, base64: string, circulaire: boolean): Promise<Lecture> {
  const rep = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": cle, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: circulaire ? 8000 : 2000,
      system: `${circulaire ? INTRO_CIRCULAIRE : INTRO_CARTE}\n${REGLES}\n${FIN_CLAUDE}`,
      tools: [OUTIL],
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
          { type: "text", text: consigne(circulaire) },
        ],
      }],
    }),
  });
  const msg = await rep.json();
  if (!rep.ok) throw new Error(msg?.error?.message ?? `erreur ${rep.status}`);
  // deno-lint-ignore no-explicit-any
  const bloc = (msg.content ?? []).find((b: any) => b.type === "tool_use");
  return {
    cartes: Array.isArray(bloc?.input?.cartes) ? bloc.input.cartes : [],
    modele: MODEL, entree: msg.usage?.input_tokens ?? 0, sortie: msg.usage?.output_tokens ?? 0,
  };
}

async function lireSecours(cle: string, base64: string, circulaire: boolean): Promise<Lecture> {
  let derniere = "aucun modèle disponible";
  for (const modele of MODELES_SECOURS) {
    const rep = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": cle, "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `${circulaire ? INTRO_CIRCULAIRE : INTRO_CARTE}\n${REGLES}\n${FIN_SECOURS}` }] },
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: base64 } }, { text: consigne(circulaire) }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: circulaire ? 8000 : 3000 },
      }),
    });
    const msg = await rep.json().catch(() => ({}));
    if (!rep.ok) {
      derniere = msg?.error?.message ?? `erreur ${rep.status}`;
      continue; // modèle retiré, quota du jour atteint… : on essaie le suivant
    }
    // deno-lint-ignore no-explicit-any
    const texteLu = (msg.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
    let lu: unknown;
    try {
      lu = JSON.parse(texteLu.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      derniere = "réponse illisible";
      continue;
    }
    // deno-lint-ignore no-explicit-any
    const cartes = Array.isArray(lu) ? lu : Array.isArray((lu as any)?.cartes) ? (lu as any).cartes : [];
    return { cartes, modele, entree: msg.usageMetadata?.promptTokenCount ?? 0, sortie: msg.usageMetadata?.candidatesTokenCount ?? 0 };
  }
  throw new Error(derniere);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: role } = await sb.rpc("role_jeton", { jeton: req.headers.get("x-jeton") ?? "" });
    if (!role) return json({ error: "Accès refusé. Entre ton code à nouveau.", acces: false });
    if (role !== "complet") return json({ error: "Accès en lecture seule : tu ne peux pas ajouter de prix." });
    const { image, visiteId, mode, priseLe } = await req.json().catch(() => ({}));
    const circulaire = mode === "circulaire";
    const prise = typeof priseLe === "string" && !Number.isNaN(Date.parse(priseLe)) ? new Date(priseLe).toISOString() : null;
    if (!image || !visiteId) return json({ error: "Photo ou visite manquante." });

    const { data: visite } = await sb.from("visites").select("id").eq("id", visiteId).maybeSingle();
    if (!visite) return json({ error: "Visite introuvable." });

    const base64 = String(image).replace(/^data:image\/\w+;base64,/, "");

    // Lecture par Claude ; si elle échoue, par le service de secours quand sa clé existe.
    let lecture: Lecture | null = null;
    let panne = "";
    let secours = false;
    const { data: cle } = await sb.rpc("lire_cle_claude");
    if (!cle) panne = "La clé API Claude n'est pas encore enregistrée.";
    else {
      try {
        lecture = await lireClaude(cle, base64, circulaire);
      } catch (e) {
        panne = e instanceof Error ? e.message : "erreur inconnue";
      }
    }
    if (!lecture) {
      const { data: cleSecours } = await sb.rpc("lire_cle_secours");
      if (!cleSecours) return json({ error: `Lecture de la photo impossible : ${panne}` });
      try {
        lecture = await lireSecours(cleSecours, base64, circulaire);
        secours = true;
      } catch (e) {
        return json({ error: `Lecture de la photo impossible. Claude : ${panne} Secours : ${e instanceof Error ? e.message : "erreur inconnue"}` });
      }
    }
    // Suivi de l'utilisation (jetons comptés par le service qui a lu la photo)
    await sb.from("usage_claude").insert({
      fonction: circulaire ? "circulaire" : "scan", modele: lecture.modele, photos: 1, entree: lecture.entree, sortie: lecture.sortie,
    });
    const cartes = lecture.cartes.filter((c) => c && typeof c === "object");
    if (!cartes.length) return json({ scans: [], message: circulaire ? "Aucune offre lisible sur cette page." : "Aucune carte de prix lisible sur cette photo." });

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
      prix_membre: c.prix_membre === true, points: typeof c.points === "number" ? Math.trunc(c.points) : null, points_details: str(c.points_details),
      cup: str(c.cup)?.replace(/\D/g, "") || null,
      code_article: str(c.code_article), prix_unitaire: str(c.prix_unitaire),
      categorie: str(c.categorie), icone: str(c.icone)?.toLowerCase() ?? null, cle_produit: str(c.cle_produit)?.toLowerCase() ?? null,
      confiance: ["haute", "moyenne", "basse"].includes(String(c.confiance)) ? String(c.confiance) : "moyenne", photo_path: photoPath, photo_prise_le: prise, source: circulaire ? "circulaire" : null,
    }));
    const { data, error } = await sb.from("scans").insert(lignes).select();
    if (error) return json({ error: error.message });
    return json({ scans: data, secours });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Erreur inconnue" });
  }
});
