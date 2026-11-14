import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { supabaseFromRequest } from "@/lib/supabase";

export const runtime = "nodejs";

type Ligne = {
  produit: string | null;
  marque: string | null;
  format: string | null;
  prix_regulier: number | null;
  prix_promo: number | null;
  promo_quantite: number | null;
  promo_texte: string | null;
  date_debut: string | null;
  date_fin: string | null;
  cup: string | null;
  code_article: string | null;
  prix_unitaire: string | null;
  confiance: string | null;
  notes: string | null;
  created_at: string;
  visites: { banniere: string; magasin: string | null; date_visite: string } | null;
};

export async function GET(req: Request) {
  const ctx = await supabaseFromRequest(req);
  if (!ctx) return NextResponse.json({ error: "Non connecté." }, { status: 401 });

  const visiteId = new URL(req.url).searchParams.get("visite");
  let q = ctx.supabase
    .from("scans")
    .select("*, visites(banniere, magasin, date_visite)")
    .order("created_at", { ascending: true })
    .limit(10000);
  if (visiteId) q = q.eq("visite_id", visiteId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const lignes = (data ?? []) as unknown as Ligne[];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Prix");
  ws.columns = [
    { header: "Date visite", key: "date_visite", width: 12 },
    { header: "Bannière", key: "banniere", width: 14 },
    { header: "Magasin", key: "magasin", width: 18 },
    { header: "Produit", key: "produit", width: 34 },
    { header: "Marque", key: "marque", width: 16 },
    { header: "Format", key: "format", width: 12 },
    { header: "Prix régulier", key: "prix_regulier", width: 13, style: { numFmt: '#,##0.00 "$"' } },
    { header: "Prix promo", key: "prix_promo", width: 12, style: { numFmt: '#,##0.00 "$"' } },
    { header: "Qté promo", key: "promo_quantite", width: 10 },
    { header: "Prix promo unitaire", key: "promo_unitaire", width: 18, style: { numFmt: '#,##0.00 "$"' } },
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
      produit: l.produit,
      marque: l.marque,
      format: l.format,
      prix_regulier: num(l.prix_regulier),
      prix_promo: num(l.prix_promo),
      promo_quantite: l.promo_quantite,
      // Formule : prix promo ramené à l'unité (H / I), vide s'il n'y a pas de promo
      promo_unitaire: { formula: `IF(H${r}="","",H${r}/IF(OR(I${r}="",I${r}=0),1,I${r}))` },
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

  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: { row: 1, column: ws.columns.length } };

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="scan-prix.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
