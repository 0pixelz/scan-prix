"use client";

import { useMemo, useState } from "react";
import { normaliser, prixEffectif } from "@/lib/comparaison";
import type { ScanAvecVisite } from "@/lib/types";
import { BANNIERES, argent, dateLisible } from "./ui";

type Point = { x: number; y: number; date: string; prix: number; promo: boolean };
type Serie = { cle: string; nom: string; couleur: string; points: Point[] };

const L = 340, H = 196, GAUCHE = 46, HAUT = 12, BAS = 24;
const JOUR = 86400000;

/** Couleur d'une bannière : toujours la même, peu importe les autres bannières affichées. */
function couleur(banniere: string): string {
  const i = BANNIERES.findIndex((b) => normaliser(b) === normaliser(banniere));
  return i >= 0 ? `var(--s${i + 1})` : "var(--muted)";
}

/** Graduations « rondes » couvrant les prix affichés. */
function graduations(min: number, max: number): number[] {
  const etendue = Math.max(max - min, max * 0.04, 0.1);
  const brut = etendue / 3;
  const puissance = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 2.5, 5, 10].map((m) => m * puissance).find((p) => p >= brut)!;
  const debut = Math.floor((min - etendue * 0.08) / pas) * pas;
  const g: number[] = [];
  for (let v = Math.max(0, debut); v < max + pas; v += pas) g.push(Math.round(v * 100) / 100);
  return g;
}

/** Évolution du prix d'un produit dans le temps, une ligne par bannière. */
export default function Graphique({ observations }: { observations: ScanAvecVisite[] }) {
  const [choisi, setChoisi] = useState<{ s: number; p: number } | null>(null);

  const { series, dates } = useMemo(() => {
    const parBanniere = new Map<string, { nom: string; parDate: Map<string, ScanAvecVisite> }>();
    for (const o of observations) { // de la plus récente à la plus ancienne : on garde le dernier relevé de chaque jour
      const nom = o.visites?.banniere?.trim();
      const date = o.visites?.date_visite;
      if (!nom || !date || prixEffectif(o) === null) continue;
      const cle = normaliser(nom);
      if (!parBanniere.has(cle)) parBanniere.set(cle, { nom, parDate: new Map() });
      const b = parBanniere.get(cle)!;
      if (!b.parDate.has(date)) b.parDate.set(date, o);
    }
    const dates = [...new Set([...parBanniere.values()].flatMap((b) => [...b.parDate.keys()]))].sort();
    return { series: [...parBanniere.entries()], dates };
  }, [observations]);

  if (dates.length < 2) return null;

  const etiquettes = series.length <= 4;
  const droite = etiquettes ? 62 : 14;
  const t0 = Date.parse(`${dates[0]}T12:00:00`);
  const t1 = Date.parse(`${dates[dates.length - 1]}T12:00:00`);
  const tousPrix = series.flatMap(([, b]) => [...b.parDate.values()].map((o) => prixEffectif(o)!));
  const grad = graduations(Math.min(...tousPrix), Math.max(...tousPrix));
  const yMin = grad[0], yMax = grad[grad.length - 1];
  const px = (date: string) => GAUCHE + ((Date.parse(`${date}T12:00:00`) - t0) / Math.max(t1 - t0, JOUR)) * (L - GAUCHE - droite);
  const py = (prix: number) => HAUT + (1 - (prix - yMin) / Math.max(yMax - yMin, 0.01)) * (H - HAUT - BAS);

  const lignes: Serie[] = series
    .map(([cle, b]) => ({
      cle,
      nom: b.nom,
      couleur: couleur(b.nom),
      points: [...b.parDate.entries()]
        .sort((a, c) => a[0].localeCompare(c[0]))
        .map(([date, o]) => ({ x: px(date), y: py(prixEffectif(o)!), date, prix: prixEffectif(o)!, promo: o.prix_promo !== null })),
    }))
    .sort((a, b) => BANNIERES.findIndex((x) => normaliser(x) === a.cle) - BANNIERES.findIndex((x) => normaliser(x) === b.cle) || a.nom.localeCompare(b.nom));

  // Étiquettes de fin de ligne : écartées d'au moins 12 px pour ne pas se chevaucher
  const fins = lignes.map((s, i) => ({ i, y: s.points[s.points.length - 1].y })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < fins.length; k++) if (fins[k].y - fins[k - 1].y < 12) fins[k].y = fins[k - 1].y + 12;
  const debordement = fins.length ? Math.max(0, fins[fins.length - 1].y - (H - BAS)) : 0;
  fins.forEach((f) => { f.y -= debordement; });

  function toucher(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * L;
    const y = ((e.clientY - r.top) / r.height) * H;
    let meilleur: { s: number; p: number } | null = null;
    let dMin = Infinity;
    lignes.forEach((s, si) => s.points.forEach((p, pi) => {
      const d = (p.x - x) ** 2 + ((p.y - y) * 0.6) ** 2;
      if (d < dMin) { dMin = d; meilleur = { s: si, p: pi }; }
    }));
    setChoisi(meilleur);
  }

  const sel = choisi && lignes[choisi.s]?.points[choisi.p] ? { serie: lignes[choisi.s], point: lignes[choisi.s].points[choisi.p] } : null;

  return (
    <div className="graphique">
      {lignes.length > 1 && (
        <div className="legende">
          {lignes.map((s) => <span key={s.cle}><i style={{ background: s.couleur }} />{s.nom}</span>)}
        </div>
      )}
      <svg viewBox={`0 0 ${L} ${H}`} role="img" aria-label="Évolution du prix par bannière" onPointerDown={toucher} onPointerMove={(e) => e.pointerType === "mouse" && toucher(e)}>
        {grad.map((g) => (
          <g key={g}>
            <line className="grille" x1={GAUCHE} x2={L - droite} y1={py(g)} y2={py(g)} />
            <text className="axe" x={GAUCHE - 6} y={py(g) + 3.5} textAnchor="end">{g.toFixed(2).replace(".", ",")} $</text>
          </g>
        ))}
        <text className="axe" x={GAUCHE} y={H - 6}>{dateLisible(dates[0])}</text>
        <text className="axe" x={L - droite} y={H - 6} textAnchor="end">{dateLisible(dates[dates.length - 1])}</text>
        {sel && <line className="repere" x1={sel.point.x} x2={sel.point.x} y1={HAUT} y2={H - BAS} />}
        {lignes.map((s) => (
          <g key={s.cle}>
            {s.points.length > 1 && <polyline className="trace" stroke={s.couleur} points={s.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} />}
            {s.points.map((p) => <circle key={p.date} className="marque" cx={p.x} cy={p.y} r={sel?.point === p ? 6 : 4} fill={s.couleur} />)}
          </g>
        ))}
        {etiquettes && fins.map((f) => (
          <text key={lignes[f.i].cle} className="fin" x={L - droite + 8} y={f.y + 3.5}>{lignes[f.i].nom}</text>
        ))}
      </svg>
      <div className="bulle">
        {sel ? (
          <>
            <i style={{ background: sel.serie.couleur }} />
            <b>{argent(sel.point.prix)}</b>
            <span>{sel.serie.nom} · {dateLisible(sel.point.date)}{sel.point.promo ? " · promo" : ""}</span>
          </>
        ) : (
          <span>Touche un point pour voir le prix.</span>
        )}
      </div>
    </div>
  );
}
