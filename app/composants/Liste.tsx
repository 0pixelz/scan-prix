"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { correspond, grouper, normaliser, type Groupe, imageGroupe } from "@/lib/comparaison";
import type { ListeNom, ProduitListe, Scan, Visite } from "@/lib/types";
import { ScannerCode } from "./Fenetres";
import IconeProduit from "./IconeProduit";
import { Fantomes } from "./Gestes";
import { ICoche, ICodeBarres, IFermer, IListe, IPlus, IRecherche, chargerTout } from "./ui";

/** Liste des produits à relever : coche automatique quand le produit est scanné dans la visite en cours. */
export default function Liste({ liste, scans, visite, recharger, listes, listeId, choisir, rechargerListes, lecture }: {
  listes: ListeNom[];
  listeId: string | null; // null = liste principale
  choisir: (id: string | null) => void;
  rechargerListes: () => Promise<void> | void;
  lecture: boolean;
  liste: ProduitListe[];
  scans: Scan[];
  visite: Visite | null;
  recharger: () => void;
}) {
  const sb = supabaseBrowser();
  const [nom, setNom] = useState("");
  const [cup, setCup] = useState("");
  const [lecteur, setLecteur] = useState(false);
  const [erreur, setErreur] = useState("");
  const [choix, setChoix] = useState(false);
  const [nomListe, setNomListe] = useState<string | null>(null); // saisie d'un nom : nouvelle liste ou renommage
  const [renommer, setRenommer] = useState(false);
  const [confirmer, setConfirmer] = useState(false);
  const courante = listes.find((l) => l.id === listeId) ?? null;
  useEffect(() => { setNomListe(null); setRenommer(false); setConfirmer(false); }, [listeId]);

  async function enregistrerListe(e: React.FormEvent) {
    e.preventDefault();
    const n = (nomListe ?? "").trim();
    if (!n) return;
    if (renommer && courante) {
      const { error } = await sb.from("listes").update({ nom: n }).eq("id", courante.id);
      if (error) return setErreur(error.message);
      await rechargerListes();
    } else {
      const { data, error } = await sb.from("listes").insert({ nom: n }).select().single();
      if (error) return setErreur(error.message);
      await rechargerListes();
      choisir((data as ListeNom).id);
    }
    setNomListe(null);
    setRenommer(false);
  }

  async function supprimerListe() {
    if (!courante) return;
    const { data, error } = await sb.from("listes").delete().eq("id", courante.id).select("id");
    if (error) return setErreur(error.message);
    if (!data?.length) return setErreur("Accès en lecture seule : suppression refusée.");
    choisir(null);
    await rechargerListes();
  }

  const releves = new Set(liste.filter((p) => scans.some((s) => correspond(p, s))).map((p) => p.id));
  const tries = [...liste].sort((a, b) => Number(releves.has(a.id)) - Number(releves.has(b.id)));

  async function ajouter(e: React.FormEvent) {
    e.preventDefault();
    if (!nom.trim()) return;
    const { error } = await sb.from("liste_produits").insert({ nom: nom.trim(), cup: cup.replace(/\D/g, "") || null, liste_id: listeId });
    if (error) return setErreur(error.message);
    setNom("");
    setCup("");
    recharger();
  }

  async function retirer(id: string) {
    const { error } = await sb.from("liste_produits").delete().eq("id", id);
    if (error) setErreur(error.message);
    else recharger();
  }

  if (choix) return <><main /><ChoixProduits liste={liste} listeId={listeId} fermer={() => setChoix(false)} ajoutes={() => { setChoix(false); recharger(); }} /></>;
  if (lecteur) return <><main /><ScannerCode fermer={() => setLecteur(false)} lu={(code) => { setCup(code); setLecteur(false); }} /></>;

  return (
    <main>
      {erreur && <div className="alert" onClick={() => setErreur("")}>{erreur}</div>}

      <div className="chips">
        <button className={listeId === null ? "on" : ""} onClick={() => choisir(null)}>Principale</button>
        {listes.map((l) => <button key={l.id} className={listeId === l.id ? "on" : ""} onClick={() => choisir(l.id)}>{l.nom}</button>)}
        {!lecture && <button onClick={() => { setRenommer(false); setNomListe(""); }}><IPlus /> Nouvelle liste</button>}
      </div>
      {nomListe !== null && (
        <form className="card" onSubmit={enregistrerListe}>
          <h2>{renommer ? "Renommer la liste" : "Nouvelle liste"}</h2>
          <input value={nomListe} onChange={(e) => setNomListe(e.target.value)} placeholder="Ex. Produits laitiers, Relevé du lundi" maxLength={40} autoFocus />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary grow" disabled={!nomListe.trim()}>{renommer ? "Renommer" : "Créer"}</button>
            <button type="button" onClick={() => { setNomListe(null); setRenommer(false); }}>Annuler</button>
          </div>
        </form>
      )}

      {!lecture && <form className="card" onSubmit={ajouter}>
        <h2>Ajouter un produit à relever</h2>
        <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Ex. Beurre salé 454 g" />
        <div className="row" style={{ marginTop: 8 }}>
          <input className="grow" value={cup} inputMode="numeric" onChange={(e) => setCup(e.target.value)} placeholder="CUP (facultatif)" />
          <button type="button" aria-label="Scanner le code-barres" onClick={() => setLecteur(true)}><ICodeBarres /></button>
          <button className="primary" disabled={!nom.trim()}><IPlus /> Ajouter</button>
        </div>
        <button type="button" className="full" style={{ marginTop: 10 }} onClick={() => setChoix(true)}>
          <IListe /> Choisir parmi mes produits déjà scannés
        </button>
      </form>}

      <div className="card">
        <div className="row between" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>{courante ? courante.nom : "À relever"}</h2>
          {liste.length > 0 && <span className="muted">{releves.size} sur {liste.length} relevés{visite ? ` · ${visite.banniere}` : ""}</span>}
        </div>
        {liste.length > 0 && <div className="bar"><i style={{ width: `${(releves.size / liste.length) * 100}%` }} /></div>}
        {!liste.length && (
          <div className="empty">
            <IListe />
            <div>Ta liste est vide.</div>
            <div className="muted">Ajoute les produits à trouver en magasin : ils se cochent tout seuls quand tu les scannes.</div>
          </div>
        )}
        {tries.map((p) => (
          <div key={p.id} className={`tx ${releves.has(p.id) ? "fait" : ""}`} style={{ cursor: "default" }}>
            <div className={`coche ${releves.has(p.id) ? "on" : ""}`}>{releves.has(p.id) && <ICoche />}</div>
            <div className="mid">
              <div className="t">{p.nom}</div>
              {p.cup && <div className="s">CUP {p.cup}</div>}
            </div>
            {!lecture && <button className="ghost icone" aria-label={`Retirer ${p.nom}`} onClick={() => retirer(p.id)}><IFermer /></button>}
          </div>
        ))}
      </div>
      {courante && !lecture && nomListe === null && (
        <div className="row" style={{ gap: 8 }}>
          <button className="grow" onClick={() => { setRenommer(true); setNomListe(courante.nom); }}>Renommer la liste</button>
          <button className="danger grow" onClick={confirmer ? supprimerListe : () => setConfirmer(true)}>{confirmer ? "Confirmer la suppression" : "Supprimer la liste"}</button>
        </div>
      )}
      {confirmer && <div className="muted" style={{ textAlign: "center", marginTop: 8 }}>La liste et ses produits à relever seront effacés définitivement. Les prix déjà relevés ne sont pas touchés.</div>}
    </main>
  );
}

/** Nom d'un produit pour la liste : marque, nom et format, sans répéter ce que le nom contient déjà. */
function nomPourListe(g: Groupe): string {
  const nom = g.nom.trim();
  const contient = (morceau: string | null) => !morceau || normaliser(nom).includes(normaliser(morceau));
  return [contient(g.marque) ? null : g.marque, nom, contient(g.format) ? null : g.format].filter(Boolean).join(" ");
}

/** Choix de produits déjà scannés à ajouter à la liste, plusieurs à la fois. */
function ChoixProduits({ liste, listeId, fermer, ajoutes }: { liste: ProduitListe[]; listeId: string | null; fermer: () => void; ajoutes: () => void }) {
  const sb = supabaseBrowser();
  const [groupes, setGroupes] = useState<Groupe[] | null>(null);
  const [coches, setCoches] = useState<Set<string>>(new Set());
  const [recherche, setRecherche] = useState("");
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    chargerTout(sb)
      .then((tout) => setGroupes(grouper(tout).filter((g) => g.nom !== "Produit non lu").sort((a, b) => a.nom.localeCompare(b.nom, "fr"))))
      .catch((e) => setErreur(e instanceof Error ? e.message : "Erreur inconnue"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Produits pas encore dans la liste
  const disponibles = (groupes ?? []).filter((g) => !liste.some((p) => g.observations.some((o) => correspond(p, o))));
  const mots = normaliser(recherche).split(" ").filter(Boolean);
  const visibles = disponibles.filter((g) => {
    if (!mots.length) return true;
    const texte = normaliser([g.nom, g.marque, g.format, g.cup, g.categorie].filter(Boolean).join(" "));
    return mots.every((m) => texte.includes(m));
  });
  const tousCoches = visibles.length > 0 && visibles.every((g) => coches.has(g.id));

  function basculer(id: string) {
    setCoches((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function toutBasculer() {
    setCoches((c) => {
      const n = new Set(c);
      visibles.forEach((g) => (tousCoches ? n.delete(g.id) : n.add(g.id)));
      return n;
    });
  }

  async function ajouter() {
    const lignes = disponibles.filter((g) => coches.has(g.id)).map((g) => ({ nom: nomPourListe(g), cup: g.cup?.replace(/\D/g, "") || null, liste_id: listeId }));
    if (!lignes.length) return;
    setEnvoi(true);
    const { error } = await sb.from("liste_produits").insert(lignes);
    setEnvoi(false);
    if (error) setErreur(error.message);
    else ajoutes();
  }

  return (
    <div className="sheet" onClick={(e) => e.target === e.currentTarget && fermer()}>
      <div className="panel selection">
        <div className="grip" />
        <div className="row between">
          <h3>Produits déjà scannés</h3>
          <button type="button" className="ghost" onClick={fermer}>Fermer</button>
        </div>
        <div className="search" style={{ marginTop: 12, background: "var(--bg)", boxShadow: "none" }}>
          <IRecherche />
          <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Chercher un produit, une marque" />
        </div>
        {erreur && <div className="alert">{erreur}</div>}
        {groupes === null && !erreur && <Fantomes n={5} />}
        {groupes !== null && !disponibles.length && (
          <div className="empty">
            <IListe />
            <div>{groupes.length ? "Tous tes produits scannés sont déjà dans la liste." : "Aucun produit scanné pour l'instant."}</div>
          </div>
        )}
        {visibles.length > 0 && (
          <button type="button" className="ghost" onClick={toutBasculer}>
            {tousCoches ? "Tout désélectionner" : `Tout sélectionner (${visibles.length})`}
          </button>
        )}
        <div className="defile">
          {disponibles.length > 0 && !visibles.length && <div className="empty"><div>Aucun produit trouvé.</div></div>}
          {visibles.map((g) => (
            <div key={g.id} className="tx" role="checkbox" aria-checked={coches.has(g.id)} onClick={() => basculer(g.id)}>
              <div className={`coche ${coches.has(g.id) ? "on" : ""}`}>{coches.has(g.id) && <ICoche />}</div>
              <IconeProduit icone={g.icone} categorie={g.categorie} image={imageGroupe(g)} />
              <div className="mid">
                <div className="t">{g.nom}</div>
                <div className="s">{[g.marque, g.format, g.cup ? `CUP ${g.cup}` : null].filter(Boolean).join(" · ") || "Aucun détail"}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="actions">
          <button className="primary full" disabled={!coches.size || envoi} onClick={ajouter}>
            {coches.size ? `Ajouter ${coches.size} produit${coches.size > 1 ? "s" : ""} à la liste` : "Sélectionne des produits"}
          </button>
        </div>
      </div>
    </div>
  );
}
