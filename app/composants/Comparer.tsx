"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { comparer, grouper, normaliser, type Groupe } from "@/lib/comparaison";
import type { ScanAvecVisite } from "@/lib/types";
import { IComparer, IRecherche, argent, chargerTout, dateLisible } from "./ui";

/** Même produit, côte à côte dans chaque bannière visitée (dernier prix relevé). */
export default function Comparer({ historique }: { historique: (g: Groupe) => void }) {
  const [scans, setScans] = useState<ScanAvecVisite[] | null>(null);
  const [erreur, setErreur] = useState("");
  const [recherche, setRecherche] = useState("");
  const [tous, setTous] = useState(false);

  useEffect(() => {
    chargerTout(supabaseBrowser()).then(setScans).catch((e) => setErreur(e.message));
  }, []);

  const lignes = useMemo(() => comparer(grouper(scans ?? [])), [scans]);
  const mots = normaliser(recherche).split(" ").filter(Boolean);
  const visibles = lignes.filter((l) => {
    if (!tous && l.parBanniere.length < 2) return false;
    if (!mots.length) return true;
    const texte = normaliser([l.groupe.nom, l.groupe.marque, l.groupe.format, l.groupe.cup, l.groupe.categorie].filter(Boolean).join(" "));
    return mots.every((m) => texte.includes(m));
  });
  const nbCompares = lignes.filter((l) => l.parBanniere.length > 1).length;

  return (
    <main>
      {erreur && <div className="alert">{erreur}</div>}
      <div className="search">
        <IRecherche />
        <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Chercher un produit" />
      </div>
      <div className="chips">
        <button className={!tous ? "on" : ""} onClick={() => setTous(false)}>Dans 2 bannières ou plus ({nbCompares})</button>
        <button className={tous ? "on" : ""} onClick={() => setTous(true)}>Tous les produits ({lignes.length})</button>
      </div>

      {scans === null && !erreur && <p className="muted">Chargement…</p>}
      {scans !== null && !visibles.length && (
        <div className="card empty">
          <IComparer />
          <div>{recherche ? "Aucun produit trouvé." : "Rien à comparer pour l'instant."}</div>
          {!recherche && <div className="muted">Relève le même produit dans deux bannières différentes pour voir l'écart de prix.</div>}
        </div>
      )}

      {visibles.map((l) => (
        <div key={l.groupe.id} className="card cmp" role="button" onClick={() => historique(l.groupe)}>
          <div className="row between">
            <div className="grow">
              <div className="t">{l.groupe.nom}</div>
              <div className="s">{[l.groupe.marque, l.groupe.format, l.groupe.categorie].filter(Boolean).join(" · ") || "Aucun détail"}</div>
            </div>
            {l.parBanniere.length > 1 && (
              <div className="ecart">
                <b>{argent(l.ecart)}</b>
                <span>{l.ecartPct.toFixed(0)} % d'écart</span>
              </div>
            )}
          </div>
          <div className="bannieres">
            {l.parBanniere.map((b, i) => (
              <div key={b.banniere} className={i === 0 && l.parBanniere.length > 1 ? "moins" : ""}>
                <span>{b.banniere}</span>
                <b>{argent(b.prix)}</b>
                <small>{b.obs.prix_promo !== null ? "Promo · " : ""}{b.obs.visites ? dateLisible(b.obs.visites.date_visite) : ""}</small>
              </div>
            ))}
          </div>
        </div>
      ))}
    </main>
  );
}
