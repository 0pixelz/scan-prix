"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { grouper, normaliser, prixEffectif, type Groupe } from "@/lib/comparaison";
import type { ListeNom, ProduitListe, Visite } from "@/lib/types";
import IconeProduit from "./IconeProduit";
import { Fantomes } from "./Gestes";
import { IExport, IJournal, IListe, IPlus, IRecherche, PastilleBanniere, argent, chargerTout, dateLisible } from "./ui";

/** Choix de la visite en cours, ouvert depuis l'en-tête de n'importe quel onglet. */
export function ChoixVisite({ visites, courante, choisir, nouvelle, gerer, fermer, lecture }: {
  visites: Visite[];
  courante: Visite | null;
  choisir: (v: Visite) => void;
  nouvelle: () => void;
  gerer: () => void;
  fermer: () => void;
  lecture: boolean;
}) {
  return (
    <div className="sheet" onClick={(e) => e.target === e.currentTarget && fermer()}>
      <div className="panel selection">
        <div className="grip" />
        <div className="row between">
          <h3>Changer de visite</h3>
          <button type="button" className="ghost" onClick={fermer}>Fermer</button>
        </div>
        <div className="defile">
          {!visites.length && <div className="empty"><div>Aucune visite.</div></div>}
          {visites.map((v) => (
            <div key={v.id} className="tx" role="button" onClick={() => choisir(v)}>
              <PastilleBanniere banniere={v.banniere} doux={v.id !== courante?.id} />
              <div className="mid">
                <div className="t">{v.banniere}{v.magasin ? ` · ${v.magasin}` : ""}</div>
                <div className="s">{dateLisible(v.date_visite)}{v.id === courante?.id ? " · en cours" : ""}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="actions">
          {!lecture && <button className="primary full" onClick={nouvelle}><IPlus /> Nouvelle visite</button>}
          <button className="full" onClick={gerer}>Gérer les visites</button>
        </div>
      </div>
    </div>
  );
}

/** Menu d'export : rapport PDF et Excel de la visite, Excel de toutes les visites. */
export function MenuExport({ visite, vide, pdf, excel, tout, fermer }: {
  visite: Visite | null;
  vide: boolean;
  pdf: () => void;
  excel: () => void;
  tout: () => void;
  fermer: () => void;
}) {
  const nom = visite ? [visite.banniere, visite.magasin].filter(Boolean).join(" · ") : "";
  return (
    <div className="sheet" onClick={(e) => e.target === e.currentTarget && fermer()}>
      <div className="panel">
        <div className="grip" />
        <div className="row between">
          <h3>Exporter</h3>
          <button type="button" className="ghost" onClick={fermer}>Fermer</button>
        </div>
        <div className="choix">
          <button type="button" disabled={!visite || vide} onClick={() => { pdf(); fermer(); }}>
            <div className="ic soft"><IJournal /></div>
            <span><b>Rapport de la visite (PDF)</b><small>{visite ? `${nom} : résumé, changements de prix, alertes et prix relevés.` : "Aucune visite en cours."}</small></span>
          </button>
          <button type="button" disabled={!visite || vide} onClick={() => { excel(); fermer(); }}>
            <div className="ic soft"><IExport /></div>
            <span><b>Excel de la visite</b><small>Tous les onglets, pour {nom || "la visite en cours"} seulement.</small></span>
          </button>
          <button type="button" onClick={() => { tout(); fermer(); }}>
            <div className="ic soft"><IExport /></div>
            <span><b>Excel de toutes les visites</b><small>L'ensemble de tes relevés, toutes bannières confondues.</small></span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** Recherche dans tout : produits de toutes les visites et produits des listes à relever. */
export function RechercheGlobale({ listes, ouvrirProduit, ouvrirListe, fermer }: {
  listes: ListeNom[];
  ouvrirProduit: (g: Groupe) => void;
  ouvrirListe: (id: string | null) => void;
  fermer: () => void;
}) {
  const sb = supabaseBrowser();
  const [texte, setTexte] = useState("");
  const [groupes, setGroupes] = useState<Groupe[] | null>(null);
  const [aRelever, setARelever] = useState<ProduitListe[]>([]);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    chargerTout(sb).then((t) => setGroupes(grouper(t))).catch((e) => setErreur(e instanceof Error ? e.message : "Erreur inconnue"));
    sb.from("liste_produits").select("*").limit(1000).then(({ data }) => setARelever((data ?? []) as ProduitListe[]));
  }, [sb]);

  const mots = normaliser(texte).split(" ").filter(Boolean);
  const produits = useMemo(() => {
    if (!groupes || !mots.length) return [];
    return groupes.filter((g) => {
      const t = normaliser([g.nom, g.marque, g.format, g.cup, g.categorie, ...new Set(g.observations.map((o) => o.visites?.banniere ?? ""))].filter(Boolean).join(" "));
      return mots.every((m) => t.includes(m));
    }).slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupes, texte]);
  const dansListes = mots.length ? aRelever.filter((p) => mots.every((m) => normaliser(`${p.nom} ${p.cup ?? ""}`).includes(m))).slice(0, 15) : [];
  const nomListe = (id: string | null | undefined) => (id ? listes.find((l) => l.id === id)?.nom ?? "Liste" : "Liste principale");

  return (
    <div className="sheet" onClick={(e) => e.target === e.currentTarget && fermer()}>
      <div className="panel selection">
        <div className="grip" />
        <div className="row between">
          <h3>Rechercher</h3>
          <button type="button" className="ghost" onClick={fermer}>Fermer</button>
        </div>
        <div className="search" style={{ marginTop: 12, background: "var(--bg)", boxShadow: "none" }}>
          <IRecherche />
          <input value={texte} onChange={(e) => setTexte(e.target.value)} placeholder="Produit, marque, CUP, bannière" autoFocus />
        </div>
        {erreur && <div className="alert">{erreur}</div>}
        <div className="defile">
          {groupes === null && !erreur && <Fantomes n={4} />}
          {groupes !== null && !mots.length && <div className="empty"><IRecherche /><div>Cherche dans toutes tes visites et tes listes.</div></div>}
          {groupes !== null && mots.length > 0 && !produits.length && !dansListes.length && <div className="empty"><div>Aucun résultat pour « {texte.trim()} ».</div></div>}
          {produits.length > 0 && <div className="sous-titre">Prix relevés</div>}
          {produits.map((g) => {
            const dernier = g.observations[0];
            const bannieres = [...new Set(g.observations.map((o) => o.visites?.banniere).filter(Boolean))];
            return (
              <div key={g.id} className="tx" role="button" onClick={() => ouvrirProduit(g)}>
                <IconeProduit icone={g.icone} categorie={g.categorie} />
                <div className="mid">
                  <div className="t">{g.nom}</div>
                  <div className="s">{[g.marque, g.format].filter(Boolean).join(" · ") || "Aucun détail"}</div>
                  <div className="s">{bannieres.join(", ")} · {g.observations.length} relevé{g.observations.length > 1 ? "s" : ""}</div>
                </div>
                <div className="r">
                  <b>{argent(prixEffectif(dernier))}</b>
                  {dernier.visites && <small>{dateLisible(dernier.visites.date_visite)}</small>}
                </div>
              </div>
            );
          })}
          {dansListes.length > 0 && <div className="sous-titre">À relever</div>}
          {dansListes.map((p) => (
            <div key={p.id} className="tx" role="button" onClick={() => ouvrirListe(p.liste_id ?? null)}>
              <div className="ic soft"><IListe /></div>
              <div className="mid"><div className="t">{p.nom}</div><div className="s">{nomListe(p.liste_id)}</div></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
