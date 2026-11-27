import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { logoBanniere } from "@/lib/bannieres";
import { alertes, comparer, cupNormalise, grouper, normaliser, prixEffectif, variations } from "@/lib/comparaison";
import { prixParUnite, texteUnite } from "@/lib/unite";
import { supabaseServer } from "@/lib/supabase";
import { lireReglages, type ScanAvecVisite } from "@/lib/types";

export const runtime = "nodejs";

const L = 595.28, H = 841.89, MARGE = 40;
const ENCRE = rgb(0.06, 0.09, 0.16), GRIS = rgb(0.39, 0.45, 0.55), TRAIT = rgb(0.89, 0.91, 0.94);
const ROUGE = rgb(0.73, 0.11, 0.11), VERT = rgb(0.08, 0.5, 0.24), ACCENT = rgb(0.06, 0.46, 0.43);

/** Texte limité aux caractères des polices standard du PDF. */
const net = (t: unknown) =>
  String(t ?? "")
    .replace(/[  ]/g, " ")
    .replace(/−/g, "-")
    .replace(/→/g, "->")
    .replace(/[^\x20-\x7E -ÿŒœ–—‘’“”…]/g, "?");
const argent = (v: number | null) => (v === null ? "-" : `${v.toFixed(2).replace(".", ",")} $`);
const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1).replace(".", ",")} %`;
const dateLongue = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("fr-CA", { day: "numeric", month: "long", year: "numeric" });

type Colonne = { titre: string; largeur: number; droite?: boolean };
type Cellule = string | { texte: string; couleur?: ReturnType<typeof rgb>; logo?: PDFImage | null };

/** Rapport d'une visite en PDF : résumé, changements de prix, alertes et liste des prix relevés. */
export async function GET(req: Request) {
  const supabase = supabaseServer(req.headers.get("x-jeton") ?? "");
  if (!supabase) return NextResponse.json({ error: "Configuration Supabase manquante." }, { status: 500 });
  const { data: acces } = await supabase.rpc("jeton_valide");
  if (!acces) return NextResponse.json({ error: "Accès refusé." }, { status: 401 });

  const visiteId = new URL(req.url).searchParams.get("visite") ?? "";
  const { data: visite } = await supabase.from("visites").select("*").eq("id", visiteId).maybeSingle();
  if (!visite) return NextResponse.json({ error: "Visite introuvable." }, { status: 404 });

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
  const releves = tout.filter((s) => s.visite_id === visiteId);

  const references = new Map<string, number>();
  const cups = [...new Set(releves.map((l) => cupNormalise(l.cup)).filter(Boolean))];
  for (let i = 0; i < cups.length; i += 150) {
    const { data } = await supabase.from("reference_prix").select("cup, prix").in("cup", cups.slice(i, i + 150));
    for (const r of data ?? []) references.set(r.cup as string, Number(r.prix));
  }
  const { data: reg } = await supabase.from("reglages").select("donnees").eq("id", 1).maybeSingle();
  const reglages = lireReglages(reg?.donnees);

  const groupes = grouper(tout);
  const changements = variations(groupes).filter((c) => c.apres.visite_id === visiteId);
  const lignes = comparer(groupes);
  const depassements = alertes(lignes, (cup) => references.get(cupNormalise(cup)), reglages.seuil);
  const ici = normaliser(visite.banniere);
  // Par rapport à la référence : seulement les prix de cette visite
  const vsRef = depassements.filter((a) => a.type === "reference" && a.obs.visite_id === visiteId);
  // Par rapport aux autres bannières : chaque produit de la visite face au prix le plus bas relevé ailleurs
  const vsAutres = lignes.flatMap((l) => {
    const moi = l.parBanniere.find((b) => b.obs.visite_id === visiteId);
    const autre = l.parBanniere.find((b) => normaliser(b.banniere) !== ici);
    if (!moi || !autre || autre.prix <= 0) return [];
    const ecart = ((moi.prix - autre.prix) / autre.prix) * 100;
    return Math.abs(ecart) >= reglages.seuil ? [{ groupe: l.groupe, moi, autre, ecart }] : [];
  }).sort((a, b) => Math.abs(b.ecart) - Math.abs(a.ecart));

  // ---------- Mise en page ----------
  const pdf = await PDFDocument.create();
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const gras = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = pdf.addPage([L, H]);
  let y = H - MARGE;
  // Logos des bannières (fichiers du site), convertis en PNG pour le PDF. Un logo introuvable est simplement omis.
  const logos = new Map<string, PDFImage | null>();
  const origine = new URL(req.url).origin;
  const sharp = await import("sharp").then((m) => m.default).catch(() => null);
  const chargerLogos = async (bannieres: (string | null | undefined)[]) => {
    await Promise.all([...new Set(bannieres.map((b) => logoBanniere(b)).filter((c): c is string => c !== null))].map(async (chemin) => {
      if (logos.has(chemin)) return;
      try {
        if (!sharp) throw new Error("conversion indisponible");
        const rep = await fetch(`${origine}${chemin}`, { signal: AbortSignal.timeout(6000) });
        if (!rep.ok) throw new Error("logo absent");
        const png = await sharp(Buffer.from(await rep.arrayBuffer())).resize({ height: 96, withoutEnlargement: true }).png().toBuffer();
        logos.set(chemin, await pdf.embedPng(png));
      } catch {
        logos.set(chemin, null);
      }
    }));
  };
  const logoDe = (banniere: string | null | undefined) => logos.get(logoBanniere(banniere) ?? "") ?? null;
  /** Dessine un logo de la hauteur voulue (largeur plafonnée) et renvoie la largeur occupée. */
  const dessinerLogo = (image: PDFImage, x: number, bas: number, hauteur: number, largeurMax: number) => {
    const e = Math.min(hauteur / image.height, largeurMax / image.width);
    page.drawImage(image, { x, y: bas + (hauteur - image.height * e) / 2, width: image.width * e, height: image.height * e });
    return image.width * e;
  };
  const place = (hauteur: number) => {
    if (y - hauteur < MARGE + 14) {
      page = pdf.addPage([L, H]);
      y = H - MARGE;
    }
  };
  const couper = (t: string, police: PDFFont, taille: number, largeur: number) => {
    let s = net(t);
    if (police.widthOfTextAtSize(s, taille) <= largeur) return s;
    while (s.length > 1 && police.widthOfTextAtSize(`${s}…`, taille) > largeur) s = s.slice(0, -1);
    return `${s.trimEnd()}…`;
  };
  const ecrire = (t: string, x: number, taille: number, police = normal, couleur = ENCRE) => page.drawText(net(t), { x, y, size: taille, font: police, color: couleur });
  const section = (titre: string, sous?: string) => {
    place(60);
    y -= 26;
    ecrire(titre, MARGE, 12.5, gras);
    if (sous) {
      y -= 13;
      ecrire(sous, MARGE, 8.5, normal, GRIS);
    }
    y -= 8;
  };
  const tableau = (colonnes: Colonne[], rangees: Cellule[][], max = Infinity) => {
    const dessiner = (cellules: Cellule[], police: PDFFont, couleurDefaut: ReturnType<typeof rgb>, taille: number) => {
      let x = MARGE;
      colonnes.forEach((c, i) => {
        const cellule = cellules[i] ?? "";
        const logo = typeof cellule === "string" ? null : cellule.logo ?? null;
        const lLogo = logo ? Math.min(9 / logo.height, 24 / logo.width) * logo.width + 4 : 0;
        const texte = couper(typeof cellule === "string" ? cellule : cellule.texte, police, taille, c.largeur - 6 - lLogo);
        const couleur = typeof cellule === "string" ? couleurDefaut : cellule.couleur ?? couleurDefaut;
        const xTexte = c.droite ? x + c.largeur - police.widthOfTextAtSize(texte, taille) : x + lLogo;
        if (logo) dessinerLogo(logo, xTexte - lLogo, y - 1.5, 9, 24);
        page.drawText(texte, { x: xTexte, y, size: taille, font: police, color: couleur });
        x += c.largeur;
      });
    };
    const entete = () => {
      y -= 12;
      dessiner(colonnes.map((c) => c.titre), gras, GRIS, 7.5);
      y -= 5;
      page.drawLine({ start: { x: MARGE, y }, end: { x: L - MARGE, y }, thickness: 0.7, color: TRAIT });
    };
    entete();
    rangees.slice(0, max).forEach((r) => {
      if (y - 15 < MARGE + 14) {
        page = pdf.addPage([L, H]);
        y = H - MARGE;
        entete();
      }
      y -= 12.5;
      dessiner(r, normal, ENCRE, 8.5);
      y -= 4;
      page.drawLine({ start: { x: MARGE, y }, end: { x: L - MARGE, y }, thickness: 0.4, color: TRAIT });
    });
    if (rangees.length > max) {
      y -= 12;
      ecrire(`… et ${rangees.length - max} autres (le détail complet est dans le fichier Excel).`, MARGE, 8, normal, GRIS);
    }
  };
  const nomProduit = (s: { produit?: string | null; marque?: string | null; format?: string | null; nom?: string }) =>
    [s.marque, s.nom ?? s.produit ?? "Produit non lu", s.format].filter(Boolean).join(" · ");

  // ---------- En-tête ----------
  y -= 8;
  ecrire("RAPPORT DE VISITE", MARGE, 8.5, gras, ACCENT);
  y -= 24;
  await chargerLogos([visite.banniere, ...vsAutres.map((a) => a.autre.banniere)]);
  const logoVisite = logoDe(visite.banniere);
  const decalage = logoVisite ? dessinerLogo(logoVisite, MARGE, y - 3, 22, 70) + 8 : 0;
  ecrire([visite.banniere, visite.magasin].filter(Boolean).join(" · "), MARGE + decalage, 20, gras);
  y -= 16;
  ecrire(dateLongue(visite.date_visite), MARGE, 10.5, normal, GRIS);
  const auteur = [reglages.filigrane.nom, reglages.filigrane.poste].filter(Boolean).join(", ");
  if (auteur) {
    y -= 13;
    ecrire(`Préparé par ${auteur}`, MARGE, 9.5, normal, GRIS);
  }
  y -= 14;
  page.drawLine({ start: { x: MARGE, y }, end: { x: L - MARGE, y }, thickness: 1, color: TRAIT });

  // ---------- Résumé ----------
  const promos = releves.filter((s) => s.prix_promo !== null).length;
  const stats: [string, string][] = [
    ["Prix relevés", String(releves.length)],
    ["En promo", releves.length ? `${promos} (${Math.round((promos / releves.length) * 100)} %)` : "0"],
    ["Prix membres", String(releves.filter((s) => s.prix_membre).length)],
    ["Hausses / baisses", `${changements.filter((c) => c.delta > 0).length} / ${changements.filter((c) => c.delta < 0).length}`],
    ["À vérifier", String(releves.filter((s) => s.confiance && s.confiance !== "haute").length)],
  ];
  y -= 22;
  const pas = (L - 2 * MARGE) / stats.length;
  stats.forEach(([titre, valeur], i) => {
    page.drawText(net(titre), { x: MARGE + i * pas, y, size: 7.5, font: gras, color: GRIS });
    page.drawText(net(valeur), { x: MARGE + i * pas, y: y - 17, size: 14, font: gras, color: ENCRE });
  });
  y -= 22;

  // ---------- Changements de prix ----------
  section("Changements de prix", `Depuis la visite précédente chez ${visite.banniere}.`);
  if (!changements.length) {
    y -= 12;
    ecrire("Aucun changement : aucun produit de cette visite n'avait été relevé avant dans cette bannière, ou les prix sont identiques.", MARGE, 8.5, normal, GRIS);
  } else {
    tableau(
      [{ titre: "PRODUIT", largeur: 255 }, { titre: "AVANT", largeur: 85, droite: true }, { titre: "MAINTENANT", largeur: 65, droite: true }, { titre: "ÉCART", largeur: 55, droite: true }, { titre: "%", largeur: 55, droite: true }],
      changements.map((c) => [
        nomProduit(c.groupe),
        `${argent(prixEffectif(c.avant))} (${c.avant.visites?.date_visite.slice(5) ?? ""})`,
        argent(prixEffectif(c.apres)),
        { texte: `${c.delta > 0 ? "+" : "-"}${argent(Math.abs(c.delta))}`, couleur: c.delta > 0 ? ROUGE : VERT },
        { texte: pct(c.pct), couleur: c.delta > 0 ? ROUGE : VERT },
      ]),
      30,
    );
  }

  // ---------- Alertes ----------
  const seuilTexte = String(reglages.seuil).replace(".", ",");
  section("Alertes", `Écarts de ${seuilTexte} % ou plus.`);
  if (!vsRef.length && !vsAutres.length) { // (les promos de circulaires, s'il y en a, suivent plus bas)
    y -= 12;
    ecrire(`Aucun écart de ${seuilTexte} % ou plus par rapport à la liste de référence ou aux autres bannières.`, MARGE, 8.5, normal, GRIS);
  }
  if (vsRef.length) {
    y -= 14;
    ecrire("Par rapport à ma référence", MARGE, 9.5, gras);
    tableau(
      [{ titre: "PRODUIT", largeur: 290 }, { titre: "PRIX RELEVÉ", largeur: 75, droite: true }, { titre: "RÉFÉRENCE", largeur: 75, droite: true }, { titre: "ÉCART", largeur: 75, droite: true }],
      vsRef.map((a) => [nomProduit(a.groupe), argent(a.prix), argent(a.base), { texte: pct(a.pct), couleur: a.pct > 0 ? ROUGE : VERT }]),
      30,
    );
  }
  if (vsAutres.length) {
    y -= 16;
    place(40);
    ecrire("Par rapport aux autres bannières (prix le plus bas relevé ailleurs)", MARGE, 9.5, gras);
    tableau(
      [{ titre: "PRODUIT", largeur: 250 }, { titre: visite.banniere.toUpperCase(), largeur: 65, droite: true }, { titre: "AILLEURS", largeur: 130, droite: true }, { titre: "ÉCART", largeur: 70, droite: true }],
      vsAutres.map((a) => [nomProduit(a.groupe), argent(a.moi.prix), { texte: `${a.autre.banniere} ${argent(a.autre.prix)}`, logo: logoDe(a.autre.banniere) }, { texte: pct(a.ecart), couleur: a.ecart > 0 ? ROUGE : VERT }]),
      30,
    );
  }

  // Promos des circulaires concurrentes sous mon prix (dernière recherche de cette visite)
  const { data: promosCirc } = await supabase.from("promos_circulaires").select("*").eq("visite_id", visiteId).not("ecart_pct", "is", null).lte("ecart_pct", -reglages.seuil).order("ecart_pct", { ascending: true }).limit(200);
  const enCours = (promosCirc ?? []).filter((p) => !p.fin || Date.parse(p.fin) > Date.now());
  if (enCours.length) {
    await chargerLogos(enCours.map((p) => p.banniere as string));
    y -= 16;
    place(40);
    ecrire("Promos des circulaires concurrentes (source Flipp, à confirmer)", MARGE, 9.5, gras);
    tableau(
      [{ titre: "PRODUIT", largeur: 215 }, { titre: "MON PRIX", largeur: 60, droite: true }, { titre: "PROMO", largeur: 120, droite: true }, { titre: "COMPARAISON", largeur: 65, droite: true }, { titre: "ÉCART", largeur: 55, droite: true }],
      enCours.map((p) => [
        [p.marque, p.produit, p.format].filter(Boolean).join(" · "),
        argent(Number(p.mon_prix)),
        { texte: `${p.banniere} ${argent(Number(p.prix))}`, logo: logoDe(p.banniere as string) },
        p.verdict === "identique" ? "Identique" : "Par unité",
        { texte: pct(Number(p.ecart_pct)), couleur: ROUGE },
      ]),
      30,
    );
  }

  // ---------- Prix relevés ----------
  section("Prix relevés", `${releves.length} prix, classés par catégorie.`);
  const tries = [...releves].sort((a, b) => (a.categorie ?? "zz").localeCompare(b.categorie ?? "zz", "fr") || (a.produit ?? "").localeCompare(b.produit ?? "", "fr"));
  tableau(
    [{ titre: "PRODUIT", largeur: 195 }, { titre: "CATÉGORIE", largeur: 105 }, { titre: "RÉGULIER", largeur: 55, droite: true }, { titre: "PROMO", largeur: 75, droite: true }, { titre: "PAR UNITÉ", largeur: 85, droite: true }],
    tries.map((s) => {
      const unite = prixParUnite(prixEffectif(s), s.format);
      const promo = s.prix_promo === null ? "" : s.promo_quantite && s.promo_quantite > 1 ? `${s.promo_quantite} / ${argent(Number(s.prix_promo))}` : argent(Number(s.prix_promo));
      return [
        nomProduit(s) + (s.prix_membre ? " (membre)" : ""),
        s.categorie ?? "",
        argent(s.prix_regulier === null ? null : Number(s.prix_regulier)),
        promo,
        unite ? texteUnite(unite) : "",
      ];
    }),
  );

  // Pied de page
  const pages = pdf.getPages();
  const genere = new Date().toLocaleDateString("fr-CA", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Toronto" });
  pages.forEach((p, i) => {
    p.drawText(net(`Scan Prix · rapport produit le ${genere}`), { x: MARGE, y: 24, size: 7.5, font: normal, color: GRIS });
    const n = `${i + 1} / ${pages.length}`;
    p.drawText(n, { x: L - MARGE - normal.widthOfTextAtSize(n, 7.5), y: 24, size: 7.5, font: normal, color: GRIS });
  });

  const octets = await pdf.save();
  return new NextResponse(Buffer.from(octets), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="rapport-${visite.date_visite}.pdf"` },
  });
}
