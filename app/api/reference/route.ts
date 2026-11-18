import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { cupNormalise } from "@/lib/comparaison";
import { supabaseServer } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

type Cellule = string | number | null;

/** Lit un fichier .xlsx ou .csv en lignes de cellules. */
async function lireLignes(nom: string, octets: ArrayBuffer): Promise<Cellule[][]> {
  if (/\.xlsx$/i.test(nom)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(octets);
    const ws = wb.worksheets[0];
    const lignes: Cellule[][] = [];
    ws?.eachRow((row) => {
      const valeurs = (row.values as unknown[]).slice(1).map((v): Cellule => {
        if (v === null || v === undefined) return null;
        if (typeof v === "number" || typeof v === "string") return v;
        if (typeof v === "object" && "result" in (v as object)) return (v as { result: Cellule }).result ?? null; // formule
        if (typeof v === "object" && "text" in (v as object)) return String((v as { text: unknown }).text);
        return String(v);
      });
      lignes.push(valeurs);
    });
    return lignes;
  }
  const texte = new TextDecoder("utf-8").decode(octets).replace(/^﻿/, "");
  const premiere = texte.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", "\t", ","].sort((a, b) => premiere.split(b).length - premiere.split(a).length)[0];
  return texte.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, "")));
}

const nombre = (v: Cellule): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const n = Number(v.replace(/\s|\$/g, "").replace(",", "."));
  return v.trim() && Number.isFinite(n) ? n : null;
};

export async function POST(req: Request) {
  const supabase = supabaseServer(req.headers.get("x-jeton") ?? "");
  if (!supabase) return NextResponse.json({ error: "Configuration Supabase manquante." }, { status: 500 });
  const { data: acces } = await supabase.rpc("jeton_valide");
  if (!acces) return NextResponse.json({ error: "Accès refusé." }, { status: 401 });

  const formulaire = await req.formData().catch(() => null);
  const fichier = formulaire?.get("fichier");
  if (!(fichier instanceof File)) return NextResponse.json({ error: "Fichier manquant." }, { status: 400 });
  if (!/\.(xlsx|csv|txt)$/i.test(fichier.name)) return NextResponse.json({ error: "Format non pris en charge. Utilise un fichier .xlsx ou .csv." }, { status: 400 });

  let lignes: Cellule[][];
  try {
    lignes = await lireLignes(fichier.name, await fichier.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Fichier illisible." }, { status: 400 });
  }
  if (!lignes.length) return NextResponse.json({ error: "Le fichier est vide." }, { status: 400 });

  // Colonnes : d'après les titres (CUP/UPC/code, prix, nom/description), sinon CUP en 1re colonne et prix en 2e.
  const titres = lignes[0].map((c) => String(c ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""));
  let iCup = titres.findIndex((t) => /cup|upc|code.?barre|gtin|ean/.test(t));
  let iPrix = titres.findIndex((t) => /prix|price|pvd|detail/.test(t));
  let iNom = titres.findIndex((t) => /nom|produit|description|desc|article|libelle/.test(t));
  const avecTitres = iCup >= 0 && iPrix >= 0;
  if (!avecTitres) {
    iCup = 0;
    iPrix = 1;
    iNom = lignes[0].length > 2 ? 2 : -1;
  }

  const refs = new Map<string, { cup: string; nom: string | null; prix: number }>();
  let ignorees = 0;
  for (const ligne of lignes.slice(avecTitres ? 1 : 0)) {
    const cup = cupNormalise(String(ligne[iCup] ?? ""));
    const prix = nombre(ligne[iPrix] ?? null);
    if (cup.length < 6 || prix === null || prix <= 0 || prix > 100000) {
      ignorees++;
      continue;
    }
    const nom = iNom >= 0 && ligne[iNom] !== null && ligne[iNom] !== undefined ? String(ligne[iNom]).trim().slice(0, 200) || null : null;
    refs.set(cup, { cup, nom, prix: Math.round(prix * 100) / 100 });
  }
  if (!refs.size) {
    return NextResponse.json({ error: "Aucun prix trouvé. Le fichier doit avoir une colonne CUP et une colonne Prix." }, { status: 400 });
  }

  const tous = [...refs.values()];
  for (let i = 0; i < tous.length; i += 500) {
    const { error } = await supabase.from("reference_prix").upsert(tous.slice(i, i + 500).map((r) => ({ ...r, importe_le: new Date().toISOString() })));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ importes: tous.length, ignorees });
}
