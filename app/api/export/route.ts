import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { comparer, grouper, normaliser, prixEffectif, promoUnitaire } from "@/lib/comparaison";
import { supabaseServer } from "@/lib/supabase";
import type { ScanAvecVisite } from "@/lib/types";

export const runtime = "nodejs";

const DOLLARS = '#,##0.00 "$"';

export async function GET(req: Request) {
  const supabase = supabaseServer(req.headers.get("x-jeton") ?? "");
  if (!supabase) return NextResponse.json({ error: "Configuration Supabase manquante." }, { status: 500 });
  const { data: acces } = await supabase.rpc("jeton_valide");
  if (!acces) return NextResponse.json({ error: "Accès refusé." }, { status: 401 });

  const visiteId = new URL(req.url).searchParams.get("visite");
  const { data, error } = await supabase
    .from("scans")
    .select("*, visites(id, banniere, magasin, date_visite)")
    .order("created_at", { ascending: true })
    .limit(10000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const tout = (data ?? []) as unknown as ScanAvecVisite[];
  const lignes = visiteId ? tout.filter((l) => l.visite_id === visiteId) : tout;

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
    { header: "Début", key: "date_debut", width: 12 },
    { header: "Fin", key: "date_fin", width: 12 },
    { header: "CUP", key: "cup", width: 16 },
    { header: "Code article", key: "code_article", width: 14 },
    { header: "Prix unitaire affiché", key: "prix_unitaire", width: 20 },
    { header: "Confiance", key: "confiance", width: 11 },
    { header: "Notes", key: "notes", width: 24 },
    { header: "Scanné le", key: "created_at", width: 18 },
  ];
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  lignes.forEach((l, i) => {
    const r = i + 2;
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
      date_debut: l.date_debut,
      date_fin: l.date_fin,
      cup: l.cup, // texte : garde les zéros de tête
      code_article: l.code_article,
      prix_unitaire: l.prix_unitaire,
      confiance: l.confiance,
      notes: l.notes,
      created_at: new Date(l.created_at).toLocaleString("fr-CA", { timeZone: "America/Toronto" }),
    });
  });
  entete(ws);

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="scan-prix.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
