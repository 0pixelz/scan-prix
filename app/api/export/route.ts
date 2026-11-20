import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { alertes, comparer, cupNormalise, grouper, normaliser, prixEffectif, promoUnitaire, variations } from "@/lib/comparaison";
import { prixParUnite } from "@/lib/unite";
import { supabaseServer } from "@/lib/supabase";
import { lireReglages, type ScanAvecVisite } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const DOLLARS = '#,##0.00 "$"';

export async function GET(req: Request) {
  const supabase = supabaseServer(req.headers.get("x-jeton") ?? "");
  if (!supabase) return NextResponse.json({ error: "Configuration Supabase manquante." }, { status: 500 });
  const { data: acces } = await supabase.rpc("jeton_valide");
  if (!acces) return NextResponse.json({ error: "Accès refusé." }, { status: 401 });

  const visiteId = new URL(req.url).searchParams.get("visite");
  // Lecture par pages de 1000 lignes (limite du service)
  const tout: ScanAvecVisite[] = [];
  for (let debut = 0; debut < 50000; debut += 1000) {
    const { data, error } = await supabase
      .from("scans")
      .select("*, visites(id, banniere, magasin, date_visite)")
      .order("created_at", { ascending: true })
      .range(debut, debut + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    tout.push(...((data ?? []) as unknown as ScanAvecVisite[]));
    if (!data || data.length < 1000) break;
  }
  const lignes = visiteId ? tout.filter((l) => l.visite_id === visiteId) : tout;

  // Prix de référence des produits relevés (par CUP)
  const references = new Map<string, number>();
  const cups = [...new Set(tout.map((l) => cupNormalise(l.cup)).filter(Boolean))];
  for (let i = 0; i < cups.length; i += 150) {
    const { data } = await supabase.from("reference_prix").select("cup, prix").in("cup", cups.slice(i, i + 150));
    for (const r of data ?? []) references.set(r.cup as string, Number(r.prix));
  }

  const wb = new ExcelJS.Workbook();
  const entete = (ws: ExcelJS.Worksheet) => {
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: "A1", to: { row: 1, column: ws.columns.length } };
  };

  // --- Onglet Résumé : une ligne par visite ---
  const resume = wb.addWorksheet("Résumé");
  resume.columns = [
    { header: "Date visite", key: "date", width: 12 },
    { header: "Bannière", key: "banniere", width: 16 },
    { header: "Magasin", key: "magasin", width: 20 },
    { header: "Prix relevés", key: "nb", width: 13 },
    { header: "Promos", key: "promos", width: 9 },
    { header: "% en promo", key: "pctPromo", width: 12, style: { numFmt: "0 %" } },
    { header: "Rabais moyen", key: "rabais", width: 14, style: { numFmt: "0.0 %" } },
    { header: "Prix membres", key: "membres", width: 13 },
    { header: "Offres de points", key: "points", width: 15 },
    { header: "À vérifier", key: "verif", width: 11 },
  ];
  const parVisite = new Map<string, ScanAvecVisite[]>();
  for (const l of lignes) {
    if (!parVisite.has(l.visite_id)) parVisite.set(l.visite_id, []);
    parVisite.get(l.visite_id)!.push(l);
  }
  [...parVisite.values()]
    .sort((a, b) => (b[0].visites?.date_visite ?? "").localeCompare(a[0].visites?.date_visite ?? ""))
    .forEach((v) => {
      const promos = v.filter((s) => s.prix_promo !== null);
      // Rabais moyen : (régulier - promo à l'unité) / régulier, sur les promos dont on connaît les deux prix
      const rabais = promos
        .map((s) => (s.prix_regulier ? (Number(s.prix_regulier) - promoUnitaire(s)!) / Number(s.prix_regulier) : null))
        .filter((r): r is number => r !== null && r > 0);
      resume.addRow({
        date: v[0].visites?.date_visite ?? null,
        banniere: v[0].visites?.banniere ?? null,
        magasin: v[0].visites?.magasin ?? null,
        nb: v.length,
        promos: promos.length,
        pctPromo: v.length ? promos.length / v.length : null,
        rabais: rabais.length ? rabais.reduce((a, b) => a + b, 0) / rabais.length : null,
        membres: v.filter((s) => s.prix_membre).length,
        points: v.filter((s) => s.points).length,
        verif: v.filter((s) => s.confiance && s.confiance !== "haute").length,
      });
    });
  entete(resume);

  // --- Onglet Comparaison : dernier prix de chaque produit dans chaque bannière (toutes les visites) ---
  const comparaison = comparer(grouper(tout)).filter((l) => l.parBanniere.length > 1);
  const bannieres = new Map<string, string>(); // clé normalisée -> nom affiché
  comparaison.forEach((l) => l.parBanniere.forEach((b) => bannieres.set(normaliser(b.banniere), b.banniere)));
  const colonnesBannieres = [...bannieres.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const cmp = wb.addWorksheet("Comparaison");
  cmp.columns = [
    { header: "Produit", key: "produit", width: 34 },
    { header: "Marque", key: "marque", width: 16 },
    { header: "Format", key: "format", width: 12 },
    { header: "Catégorie", key: "categorie", width: 22 },
    { header: "CUP", key: "cup", width: 16 },
    ...colonnesBannieres.map(([cle, nom]) => ({ header: nom, key: `b:${cle}`, width: 13, style: { numFmt: DOLLARS } })),
    { header: "Moins cher", key: "moins", width: 16 },
    { header: "Écart ($)", key: "ecart", width: 11, style: { numFmt: DOLLARS } },
    { header: "Écart (%)", key: "ecartPct", width: 11, style: { numFmt: "0.0 %" } },
  ];
  comparaison.forEach((l) => {
    cmp.addRow({
      produit: l.groupe.nom,
      marque: l.groupe.marque,
      format: l.groupe.format,
      categorie: l.groupe.categorie,
      cup: l.groupe.cup,
      ...Object.fromEntries(l.parBanniere.map((b) => [`b:${normaliser(b.banniere)}`, b.prix])),
      moins: l.parBanniere[0].banniere,
      ecart: l.ecart,
      ecartPct: l.ecartPct / 100,
    });
  });
  if (!comparaison.length) cmp.addRow({ produit: "Aucun produit relevé dans deux bannières pour l'instant." });
  entete(cmp);

  // --- Onglet Alertes : écarts qui dépassent le seuil choisi dans l'app ---
  const { data: reg } = await supabase.from("reglages").select("donnees").eq("id", 1).maybeSingle();
  const seuil = lireReglages(reg?.donnees).seuil;
  const al = wb.addWorksheet("Alertes");
  al.columns = [
    { header: "Type", key: "type", width: 18 },
    { header: "Produit", key: "produit", width: 34 },
    { header: "Marque", key: "marque", width: 16 },
    { header: "Format", key: "format", width: 12 },
    { header: "CUP", key: "cup", width: 16 },
    { header: "Bannière", key: "banniere", width: 14 },
    { header: "Date visite", key: "date", width: 12 },
    { header: "Prix", key: "prix", width: 11, style: { numFmt: DOLLARS } },
    { header: "Comparé à", key: "baseNom", width: 16 },
    { header: "Prix comparé", key: "base", width: 13, style: { numFmt: DOLLARS } },
    { header: "Écart ($)", key: "ecart", width: 11, style: { numFmt: DOLLARS } },
    { header: "Écart (%)", key: "pct", width: 11, style: { numFmt: "0.0 %" } },
    { header: "Seuil (%)", key: "seuil", width: 10 },
  ];
  const depassements = alertes(comparer(grouper(tout)), (cup) => references.get(cupNormalise(cup)), seuil)
    .filter((a) => !visiteId || a.obs.visite_id === visiteId);
  depassements.forEach((a) => {
    al.addRow({
      type: a.type === "reference" ? "Référence" : "Entre bannières",
      produit: a.groupe.nom, marque: a.groupe.marque, format: a.groupe.format, cup: a.groupe.cup,
      banniere: a.banniere, date: a.obs.visites?.date_visite ?? null,
      prix: a.prix, baseNom: a.baseNom, base: a.base, ecart: a.prix - a.base, pct: a.pct / 100, seuil,
    });
  });
  if (!depassements.length) al.addRow({ type: `Aucun écart de ${seuil} % ou plus.` });
  entete(al);

  // --- Onglet Circulaires : promos concurrentes trouvées à la dernière recherche (source Flipp, non officielle) ---
  const requetePromos = supabase.from("promos_circulaires").select("*").order("ecart_pct", { ascending: true }).limit(5000);
  const { data: promos } = await (visiteId ? requetePromos.eq("visite_id", visiteId) : requetePromos);
  const ci = wb.addWorksheet("Circulaires");
  ci.columns = [
    { header: "Produit", key: "produit", width: 34 },
    { header: "Marque", key: "marque", width: 16 },
    { header: "Format", key: "format", width: 12 },
    { header: "CUP", key: "cup", width: 16 },
    { header: "Mon prix", key: "mon_prix", width: 11, style: { numFmt: DOLLARS } },
    { header: "Source de mon prix", key: "source_prix", width: 18 },
    { header: "Bannière", key: "banniere", width: 16 },
    { header: "Offre de la circulaire", key: "offre", width: 40 },
    { header: "Format de l'offre", key: "format_offre", width: 14 },
    { header: "Prix promo", key: "prix", width: 11, style: { numFmt: DOLLARS } },
    { header: "Quantité", key: "quantite", width: 9 },
    { header: "Comparaison", key: "verdict", width: 22 },
    { header: "Écart (%)", key: "ecart", width: 11, style: { numFmt: "0.0 %" } },
    { header: "Fin de la promo", key: "fin", width: 14 },
    { header: "Trouvée le", key: "trouve", width: 12 },
  ];
  (promos ?? []).forEach((p) => {
    ci.addRow({
      ...p, mon_prix: Number(p.mon_prix), prix: Number(p.prix),
      verdict: p.verdict === "identique" ? "Identique" : p.ecart_pct === null ? "Proche, format à confirmer" : "Proche, par unité",
      ecart: p.ecart_pct === null ? null : Number(p.ecart_pct) / 100,
      fin: p.fin ? String(p.fin).slice(0, 10) : null, trouve: String(p.trouve_le).slice(0, 10),
    });
  });
  if (!promos?.length) ci.addRow({ produit: "Aucune promo gardée. Lance une recherche dans Analyse > Circulaires." });
  entete(ci);

  // --- Onglet Variations : dernier prix comparé à la visite précédente dans la même bannière ---
  const vr = wb.addWorksheet("Variations");
  vr.columns = [
    { header: "Produit", key: "produit", width: 34 },
    { header: "Marque", key: "marque", width: 16 },
    { header: "Format", key: "format", width: 12 },
    { header: "CUP", key: "cup", width: 16 },
    { header: "Bannière", key: "banniere", width: 14 },
    { header: "Date avant", key: "date_avant", width: 12 },
    { header: "Prix avant", key: "avant", width: 12, style: { numFmt: DOLLARS } },
    { header: "Date après", key: "date_apres", width: 12 },
    { header: "Prix après", key: "apres", width: 12, style: { numFmt: DOLLARS } },
    { header: "Variation ($)", key: "delta", width: 13, style: { numFmt: DOLLARS } },
    { header: "Variation (%)", key: "pct", width: 13, style: { numFmt: "0.0 %" } },
  ];
  const changements = variations(grouper(tout)).filter((c) => !visiteId || c.apres.visite_id === visiteId);
  changements.forEach((c) => {
    vr.addRow({
      produit: c.groupe.nom, marque: c.groupe.marque, format: c.groupe.format, cup: c.groupe.cup, banniere: c.banniere,
      date_avant: c.avant.visites?.date_visite ?? null, avant: prixEffectif(c.avant),
      date_apres: c.apres.visites?.date_visite ?? null, apres: prixEffectif(c.apres),
      delta: c.delta, pct: c.pct / 100,
    });
  });
  if (!changements.length) vr.addRow({ produit: "Aucun changement de prix entre deux visites pour l'instant." });
  entete(vr);

  // --- Onglet Prix : données brutes ---
  const ws = wb.addWorksheet("Prix");
  ws.columns = [
    { header: "Date visite", key: "date_visite", width: 12 },
    { header: "Bannière", key: "banniere", width: 14 },
    { header: "Magasin", key: "magasin", width: 18 },
    { header: "Catégorie", key: "categorie", width: 22 },
    { header: "Produit", key: "produit", width: 34 },
    { header: "Marque", key: "marque", width: 16 },
    { header: "Format", key: "format", width: 12 },
    { header: "Prix régulier", key: "prix_regulier", width: 13, style: { numFmt: DOLLARS } },
    { header: "Prix promo", key: "prix_promo", width: 12, style: { numFmt: DOLLARS } },
    { header: "Qté promo", key: "promo_quantite", width: 10 },
    { header: "Prix promo unitaire", key: "promo_unitaire", width: 18, style: { numFmt: DOLLARS } },
    { header: "Prix payé", key: "prix_paye", width: 11, style: { numFmt: DOLLARS } },
    { header: "Offre", key: "promo_texte", width: 24 },
    { header: "Prix membre", key: "prix_membre", width: 12 },
    { header: "Points", key: "points", width: 9 },
    { header: "Détail des points", key: "points_details", width: 28 },
    { header: "Début", key: "date_debut", width: 12 },
    { header: "Fin", key: "date_fin", width: 12 },
    { header: "CUP", key: "cup", width: 16 },
    { header: "Code article", key: "code_article", width: 14 },
    { header: "Prix unitaire affiché", key: "prix_unitaire", width: 20 },
    { header: "Confiance", key: "confiance", width: 11 },
    { header: "Notes", key: "notes", width: 24 },
    { header: "Photo prise le", key: "created_at", width: 18 },
    { header: "Source", key: "source", width: 11 },
    { header: "Prix par unité", key: "prix_unite", width: 14, style: { numFmt: '#,##0.000 "$"' } },
    { header: "Unité de comparaison", key: "unite", width: 19 },
    { header: "Prix de référence", key: "reference", width: 16, style: { numFmt: DOLLARS } },
    { header: "Écart vs référence ($)", key: "ecart_ref", width: 20, style: { numFmt: DOLLARS } },
    { header: "Écart vs référence (%)", key: "ecart_ref_pct", width: 20, style: { numFmt: "0.0 %" } },
  ];
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  lignes.forEach((l, i) => {
    const r = i + 2;
    const paye = prixEffectif(l);
    const unite = prixParUnite(paye, l.format);
    const ref = references.get(cupNormalise(l.cup)) ?? null;
    ws.addRow({
      date_visite: l.visites?.date_visite ?? null,
      banniere: l.visites?.banniere ?? null,
      magasin: l.visites?.magasin ?? null,
      categorie: l.categorie,
      produit: l.produit,
      marque: l.marque,
      format: l.format,
      prix_regulier: num(l.prix_regulier),
      prix_promo: num(l.prix_promo),
      promo_quantite: l.promo_quantite,
      // Formules : prix promo ramené à l'unité (I / J), puis prix payé (promo unitaire, sinon régulier)
      promo_unitaire: { formula: `IF(I${r}="","",I${r}/IF(OR(J${r}="",J${r}=0),1,J${r}))`, result: promoUnitaire(l) ?? "" },
      prix_paye: { formula: `IF(K${r}="",H${r},K${r})`, result: prixEffectif(l) ?? "" },
      promo_texte: l.promo_texte,
      prix_membre: l.prix_membre ? "Oui" : null,
      points: l.points,
      points_details: l.points_details,
      date_debut: l.date_debut,
      date_fin: l.date_fin,
      cup: l.cup, // texte : garde les zéros de tête
      code_article: l.code_article,
      prix_unitaire: l.prix_unitaire,
      confiance: l.confiance,
      notes: l.notes,
      created_at: new Date(l.photo_prise_le ?? l.created_at).toLocaleString("fr-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }),
      source: l.source === "circulaire" ? "Circulaire" : "Carte",
      prix_unite: unite ? unite.valeur : null,
      unite: unite ? unite.unite : null,
      reference: ref,
      ecart_ref: ref !== null && paye !== null ? paye - ref : null,
      ecart_ref_pct: ref !== null && paye !== null && ref > 0 ? (paye - ref) / ref : null,
    });
  });
  entete(ws);

  // --- Onglet Produits : photo, description, prix, et la bannière où le produit est moins cher ---
  const pr = wb.addWorksheet("Produits");
  pr.columns = [
    { header: "Photo", key: "photo", width: 12 },
    { header: "Produit", key: "produit", width: 34 },
    { header: "Marque", key: "marque", width: 16 },
    { header: "Format", key: "format", width: 12 },
    { header: "Catégorie", key: "categorie", width: 22 },
    { header: "CUP", key: "cup", width: 16 },
    { header: "Bannière", key: "banniere", width: 14 },
    { header: "Date du relevé", key: "date", width: 13 },
    { header: "Prix", key: "prix", width: 10, style: { numFmt: DOLLARS } },
    { header: "Prix régulier", key: "regulier", width: 12, style: { numFmt: DOLLARS } },
    { header: "En promo", key: "promo", width: 9 },
    { header: "Moins cher chez", key: "moinsCher", width: 18 },
    { header: "Prix le plus bas ailleurs", key: "prixBas", width: 14, style: { numFmt: DOLLARS } },
    { header: "Écart ($)", key: "ecart", width: 10, style: { numFmt: DOLLARS } },
    { header: "Écart (%)", key: "ecartPct", width: 10, style: { numFmt: "0.0 %" } },
    { header: "Source du prix le plus bas", key: "source", width: 24 },
    { header: "Prix dans les autres bannières", key: "autres", width: 46 },
  ];
  const cleProduit = (nom: string | null, marque: string | null, format: string | null) => [nom, marque, format].map((t) => normaliser(t ?? "")).join("|");
  const promosParProduit = new Map<string, NonNullable<typeof promos>>();
  for (const p of promos ?? []) {
    // Seules les offres au même format se comparent au prix affiché ; les promos terminées sont ignorées.
    if (p.verdict !== "identique" || (p.fin && Date.parse(p.fin) < Date.now())) continue;
    const k = cleProduit(p.produit, p.marque, p.format);
    promosParProduit.set(k, [...(promosParProduit.get(k) ?? []), p]);
  }
  const aImager: { rangee: number; image: string | null; carte: string | null }[] = [];
  for (const l of comparer(grouper(tout))) {
    const g = l.groupe;
    const base = visiteId ? g.observations.find((o) => o.visite_id === visiteId) : g.observations[0];
    const prix = base ? prixEffectif(base) : null;
    if (!base || prix === null) continue;
    const ici = normaliser(base.visites?.banniere ?? "");
    const ailleurs = [
      ...l.parBanniere.filter((b) => normaliser(b.banniere) !== ici).map((b) => ({ banniere: b.banniere, prix: b.prix, source: `Relevé du ${b.obs.visites?.date_visite ?? ""}` })),
      ...(promosParProduit.get(cleProduit(g.nom, g.marque, g.format)) ?? []).filter((p) => normaliser(p.banniere) !== ici)
        .map((p) => ({ banniere: p.banniere as string, prix: Number(p.prix), source: `Circulaire${p.fin ? ` jusqu'au ${String(p.fin).slice(0, 10)}` : ""}` })),
    ].sort((a, b) => a.prix - b.prix);
    const bas = ailleurs[0];
    const moins = bas && bas.prix < prix - 0.005;
    const rangee = pr.addRow({
      produit: g.nom, marque: g.marque, format: g.format, categorie: g.categorie, cup: g.cup,
      banniere: base.visites?.banniere ?? null, date: base.visites?.date_visite ?? null,
      prix, regulier: base.prix_regulier === null ? null : Number(base.prix_regulier), promo: base.prix_promo !== null ? "Oui" : "Non",
      moinsCher: !bas ? "Aucun autre prix" : moins ? bas.banniere : "Nulle part",
      prixBas: bas ? bas.prix : null,
      ecart: bas ? bas.prix - prix : null,
      ecartPct: bas ? (bas.prix - prix) / prix : null,
      source: bas ? bas.source : null,
      autres: ailleurs.map((a) => `${a.banniere} ${a.prix.toFixed(2).replace(".", ",")} $`).join(" · "),
    });
    rangee.height = 60;
    rangee.alignment = { vertical: "middle", wrapText: true };
    if (moins) rangee.getCell("moinsCher").font = { bold: true, color: { argb: "FFB91C1C" } };
    aImager.push({ rangee: rangee.number, image: g.observations.find((o) => o.image_produit)?.image_produit ?? null, carte: base.photo_path });
  }
  entete(pr);

  // Photos : l'image du produit quand elle existe, sinon la carte de prix photographiée (réduite).
  // Le temps est limité : au-delà de 300 produits ou d'une douzaine de secondes, les photos restantes sont laissées vides.
  const limite = Date.now() + 12000;
  const sharp = await import("sharp").then((m) => m.default).catch(() => null);
  const telecharger = async (adresse: string) => {
    const rep = await fetch(adresse, { signal: AbortSignal.timeout(4000) });
    if (!rep.ok) throw new Error("image");
    return Buffer.from(await rep.arrayBuffer());
  };
  const imager = async (x: (typeof aImager)[number]) => {
    if (Date.now() > limite) return;
    try {
      let octets: Buffer | null = null;
      if (x.image) octets = await telecharger(x.image);
      else if (x.carte && sharp) {
        const rep = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/photo`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`, "x-jeton": req.headers.get("x-jeton") ?? "" },
          body: JSON.stringify({ path: x.carte }),
          signal: AbortSignal.timeout(4000),
        });
        const adresse = (await rep.json())?.url;
        if (typeof adresse === "string") octets = await telecharger(adresse);
      }
      if (!octets) return;
      if (sharp) octets = await sharp(octets).rotate().resize(160, 160, { fit: "contain", background: "#ffffff" }).jpeg({ quality: 78 }).toBuffer();
      const id = wb.addImage({ buffer: octets as unknown as ExcelJS.Buffer, extension: "jpeg" });
      pr.addImage(id, { tl: { col: 0.08, row: x.rangee - 1 + 0.06 }, ext: { width: 72, height: 72 } });
    } catch { /* photo indisponible : la cellule reste vide */ }
  };
  const file = aImager.slice(0, 300);
  for (let i = 0; i < file.length && Date.now() < limite; i += 10) await Promise.all(file.slice(i, i + 10).map(imager));

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="scan-prix.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
