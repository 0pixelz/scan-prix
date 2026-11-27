"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { prixEffectif } from "@/lib/comparaison";
import { ecartPromo, imageOffre, lienOffre, pctLisible, type Offre } from "@/lib/promos";
import type { Scan } from "@/lib/types";
import { IChevron, PastilleBanniere, argent, dateLisible } from "./ui";

type Garde = { quand: number; juge: boolean; offres: Offre[] };
const DUREE = 6 * 3600 * 1000;

/**
 * Sur la fiche d'un prix : les promos en cours dans les circulaires des autres bannières pour ce produit, avec
 * l'écart par rapport au prix relevé. Recherche Flipp (source non officielle) : à confirmer dans la circulaire.
 */
export default function PromosProduit({ scan, banniere, codePostal, seuil, lecture, change, voir }: {
  voir?: (image: string) => void; // ouvre l'offre de la circulaire en grand, dans l'app
  scan: Scan;
  banniere: string | null;
  codePostal: string;
  seuil: number;
  lecture?: boolean;
  change?: () => void; // les promos gardées ont changé
}) {
  const sb = supabaseBrowser();
  const [garde, setGarde] = useState<Garde | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState("");
  const prix = prixEffectif(scan);
  const codeValide = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/.test(codePostal.trim());
  const possible = codeValide && prix !== null && Boolean(scan.produit);
  const cle = `scanprix.promo.${scan.id}`;

  const chercher = useCallback(async () => {
    if (!possible || prix === null) return;
    setOccupe(true);
    setErreur("");
    try {
      const { data, error } = await sb.functions.invoke("promos", {
        body: { codePostal, exclure: banniere ? [banniere] : [], produits: [{ id: scan.id, nom: scan.produit, marque: scan.marque, format: scan.format }] },
      });
      if (error || !data || data.error || data.acces === false) throw new Error(data?.error ?? "Recherche de circulaires indisponible pour l'instant.");
      const offres = ((data.resultats?.[0]?.offres ?? []) as Offre[]);
      const g: Garde = { quand: Date.now(), juge: data.juge === true, offres };
      setGarde(g);
      try { sessionStorage.setItem(cle, JSON.stringify(g)); } catch { /* stockage indisponible */ }
      // Gardées pour la liste des prix, les alertes, l'Excel et le rapport.
      if (!lecture) {
        const anciennes = sb.from("promos_circulaires").delete().eq("visite_id", scan.visite_id).eq("produit", scan.produit ?? "");
        const { error: e1 } = await (scan.marque ? anciennes.eq("marque", scan.marque) : anciennes.is("marque", null));
        const lignes = offres.map((o) => {
          const e = ecartPromo(prix, scan.format, o);
          return {
            visite_id: scan.visite_id, produit: scan.produit, marque: scan.marque, format: scan.format, cup: scan.cup,
            mon_prix: prix, source_prix: `Relevé ${banniere ?? ""}`.trim(), banniere: o.banniere, offre: o.nom, prix: o.prix, prix_offre: o.prixOffre,
            quantite: o.quantite, format_offre: o.format, verdict: o.verdict, ecart_pct: e ? Math.round(e.pct * 10) / 10 : null,
            par_unite: e?.parUnite ?? null, fin: o.fin, lien: lienOffre(o.lien),
          };
        });
        if (!e1 && lignes.length) await sb.from("promos_circulaires").insert(lignes);
        change?.();
      }
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setOccupe(false);
    }
  }, [sb, possible, prix, codePostal, banniere, scan.id, scan.produit, scan.marque, scan.format, scan.cup, scan.visite_id, lecture, change, cle]);

  // À l'ouverture de la fiche : la dernière recherche si elle a moins de 6 heures, sinon une nouvelle.
  useEffect(() => {
    if (!possible) return;
    try {
      const g = JSON.parse(sessionStorage.getItem(cle) ?? "null") as Garde | null;
      if (g && Date.now() - g.quand < DUREE) return setGarde(g);
    } catch { /* stockage indisponible */ }
    chercher();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle]);

  if (prix === null || !scan.produit) return null;
  const offres = (garde?.offres ?? [])
    .map((o) => ({ o, e: ecartPromo(prix, scan.format, o) }))
    .sort((a, b) => (a.e?.pct ?? 999) - (b.e?.pct ?? 999));

  return (
    <div className="promos-produit">
      <div className="row between">
        <b>En circulaire chez les concurrents</b>
        {possible && !occupe && <button type="button" className="lien" onClick={chercher}>Actualiser</button>}
      </div>
      {!codeValide && <div className="muted">Entre ton code postal dans Réglages, Circulaires et alertes, pour voir les promos des concurrents ici.</div>}
      {occupe && <div className="muted">Recherche dans les circulaires…</div>}
      {erreur && <div className="muted">{erreur}</div>}
      {garde && !occupe && !offres.length && <div className="muted">Aucune promo comparable cette semaine.</div>}
      {!occupe && offres.map(({ o, e }, i) => {
        // L'offre s'ouvre dans l'app (image de la circulaire) ; sans image, le lien mène au site des circulaires.
        const image = voir ? imageOffre(o.image) : null;
        const lien = image ? null : lienOffre(o.lien);
        const Ligne = lien ? "a" : "div";
        return (
        <Ligne className={`offre ${image ? "ouvrable" : ""}`} key={i}
          {...(image ? { role: "button", onClick: () => voir!(image), "aria-label": `Voir l'offre de ${o.banniere} dans la circulaire` } : {})}
          {...(lien ? { href: lien, target: "_blank", rel: "noopener noreferrer", "aria-label": `Voir l'offre de ${o.banniere} dans la circulaire` } : {})}>
          <PastilleBanniere banniere={o.banniere} doux />
          <div className="mid">
            <div className="t">{o.banniere} <span className={`pill ${o.verdict === "identique" ? "baisse" : "verif"}`}>{o.verdict === "identique" ? "Identique" : o.verdict === "proche" ? "Proche" : "À confirmer"}</span></div>
            <div className="s">{o.nom}</div>
            <div className="s">{[o.quantite > 1 ? `${o.quantite} pour ${argent(o.prixOffre)}` : null, o.fin ? `jusqu'au ${dateLisible(new Date(o.fin).toLocaleDateString("en-CA"))}` : null, e?.parUnite].filter(Boolean).join(" · ")}</div>
          </div>
          <div className="r">
            <b>{argent(o.prix)}</b>
            {e ? <span className={e.pct <= -seuil ? "hausse" : "muted"}>{pctLisible(e.pct)}</span> : <small>sans écart</small>}
          </div>
          {(lien || image) && <IChevron />}
        </Ligne>
        );
      })}
      {garde && !occupe && offres.length > 0 && (
        <small className="source">
          <img src="/bannieres/reebee.webp" alt="reebee" />
          <span>Circulaires de Flipp et reebee (même plateforme, source non officielle), à confirmer. Touche une offre pour la voir telle qu'imprimée dans la circulaire. Écart par rapport à ton prix de {argent(prix)}.</span>
        </small>
      )}
    </div>
  );
}
