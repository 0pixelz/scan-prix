"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { prixEffectif, type Groupe } from "@/lib/comparaison";
import { TYPES_PRODUIT } from "@/lib/icones";
import { CATEGORIES, type Scan, type Visite } from "@/lib/types";
import Visionneuse from "./Visionneuse";
import { BANNIERES, ICodeBarres, argent, aujourdhui, dateLisible } from "./ui";

export function NouvelleVisite({ fermer, creee }: { fermer?: () => void; creee: (v: Visite) => void }) {
  const [banniere, setBanniere] = useState("");
  const [autre, setAutre] = useState(false);
  const [magasin, setMagasin] = useState("");
  const [date, setDate] = useState(aujourdhui());
  const [erreur, setErreur] = useState("");

  async function creer(e: React.FormEvent) {
    e.preventDefault();
    const { data, error } = await supabaseBrowser()
      .from("visites")
      .insert({ banniere: banniere.trim(), magasin: magasin.trim() || null, date_visite: date })
      .select()
      .single();
    if (error) setErreur(error.message);
    else creee(data as Visite);
  }

  return (
    <div className="sheet" onClick={(e) => e.target === e.currentTarget && fermer?.()}>
      <form className="panel" onSubmit={creer}>
        <div className="grip" />
        <h3>Nouvelle visite</h3>
        <label>Bannière</label>
        <div className="tuiles">
          {BANNIERES.map((b, i) => (
            <button type="button" key={b} className={!autre && banniere === b ? "on" : ""} aria-pressed={!autre && banniere === b} onClick={() => { setAutre(false); setBanniere(b); }}>
              <span style={{ "--h": (i * 47 + 172) % 360 } as React.CSSProperties}>{b.charAt(0)}</span>
              {b}
            </button>
          ))}
          <button type="button" className={autre ? "on" : ""} aria-pressed={autre} onClick={() => { setAutre(true); setBanniere(""); }}>
            <span style={{ "--h": 215 } as React.CSSProperties}>+</span>
            Autre
          </button>
        </div>
        {autre && <input style={{ marginTop: 10 }} value={banniere} onChange={(e) => setBanniere(e.target.value)} placeholder="Nom de la bannière" autoFocus />}
        <label>Magasin (ville, succursale)</label>
        <input value={magasin} onChange={(e) => setMagasin(e.target.value)} placeholder="Ex. Mirabel" />
        <label>Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        {erreur && <div className="alert" style={{ marginTop: 12 }}>{erreur}</div>}
        <div className="actions">
          <button className="primary full" disabled={!banniere.trim()}>Commencer</button>
          {fermer && <button type="button" className="full" onClick={fermer}>Annuler</button>}
        </div>
      </form>
    </div>
  );
}

/** Lecteur de code-barres avec la caméra (CUP / EAN). */
export function ScannerCode({ fermer, lu }: { fermer: () => void; lu: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [erreur, setErreur] = useState("");
  const surLecture = useRef(lu);
  surLecture.current = lu;

  useEffect(() => {
    let controles: { stop: () => void } | undefined;
    let fini = false;
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (fini || !video.current) return;
        controles = await new BrowserMultiFormatReader().decodeFromConstraints(
          { video: { facingMode: "environment" } },
          video.current,
          (resultat) => {
            const code = resultat?.getText().replace(/\D/g, "");
            if (!fini && code && code.length >= 8) {
              fini = true;
              controles?.stop();
              surLecture.current(code);
            }
          },
        );
        if (fini) controles.stop();
      } catch {
        setErreur("Caméra indisponible. Autorise l'accès à la caméra, ou entre le code à la main.");
      }
    })();
    return () => { fini = true; controles?.stop(); };
  }, []);

  return (
    <div className="sheet lecteur">
      <div className="panel">
        <div className="grip" />
        <div className="row between">
          <h3>Scanner le code-barres</h3>
          <button type="button" className="ghost" onClick={fermer}>Fermer</button>
        </div>
        {erreur ? <div className="alert" style={{ marginTop: 12 }}>{erreur}</div> : (
          <>
            <div className="viseur"><video ref={video} playsInline muted /><span /></div>
            <div className="muted" style={{ textAlign: "center" }}>Place le code-barres dans le cadre.</div>
          </>
        )}
      </div>
    </div>
  );
}

const CHAMPS_EDITION = ["produit", "marque", "format", "categorie", "icone", "prix_regulier", "prix_promo", "promo_quantite", "promo_texte", "points", "points_details", "date_debut", "date_fin", "cup", "code_article", "prix_unitaire", "notes"];

export function Edition({ scan, fermer, enregistre, supprime, historique }: {
  scan: Scan;
  fermer: () => void;
  enregistre: (s: Scan) => void;
  supprime: (id: string) => void;
  historique: (s: Scan) => void;
}) {
  const sb = supabaseBrowser();
  const [f, setF] = useState<Record<string, string>>(() =>
    Object.fromEntries(CHAMPS_EDITION.map((k) => [k, (scan as Record<string, unknown>)[k]?.toString() ?? ""])),
  );
  const [membre, setMembre] = useState(Boolean(scan.prix_membre));
  const [photo, setPhoto] = useState<string | null>(null);
  const [erreur, setErreur] = useState("");
  const [confirmer, setConfirmer] = useState(false);
  const [lecteur, setLecteur] = useState(false);
  const [agrandie, setAgrandie] = useState(false);

  useEffect(() => {
    if (!scan.photo_path) return;
    sb.functions.invoke("photo", { body: { path: scan.photo_path } }).then(({ data }) => setPhoto(data?.url ?? null));
  }, [sb, scan.photo_path]);

  const champ = (k: string, libelle: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label>{libelle}</label>
      <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />
    </div>
  );

  async function sauver(e: React.FormEvent) {
    e.preventDefault();
    const t = (k: string) => f[k].trim() || null;
    const n = (k: string) => {
      const v = parseFloat(f[k].replace(",", "."));
      return Number.isFinite(v) ? v : null;
    };
    const qte = n("promo_quantite");
    const pts = n("points");
    const maj = {
      produit: t("produit"), marque: t("marque"), format: t("format"), categorie: t("categorie"), icone: t("icone"),
      prix_regulier: n("prix_regulier"), prix_promo: n("prix_promo"),
      promo_quantite: qte === null ? null : Math.trunc(qte),
      promo_texte: t("promo_texte"), date_debut: t("date_debut"), date_fin: t("date_fin"),
      prix_membre: membre, points: pts === null ? null : Math.trunc(pts), points_details: t("points_details"),
      cup: t("cup")?.replace(/\D/g, "") || null, code_article: t("code_article"), prix_unitaire: t("prix_unitaire"), notes: t("notes"),
      confiance: "haute", // vérifié à la main
    };
    const { data, error } = await sb.from("scans").update(maj).eq("id", scan.id).select().single();
    if (error) setErreur(error.message);
    else enregistre(data as Scan);
  }

  async function effacer() {
    const { error } = await sb.from("scans").delete().eq("id", scan.id);
    if (error) return setErreur(error.message);
    supprime(scan.id);
  }

  if (lecteur) return <ScannerCode fermer={() => setLecteur(false)} lu={(code) => { setF((v) => ({ ...v, cup: code })); setLecteur(false); }} />;
  if (agrandie && photo) return <Visionneuse src={photo} fermer={() => setAgrandie(false)} />;

  return (
    <div className="sheet" onClick={(e) => e.target === e.currentTarget && fermer()}>
      <form className="panel" onSubmit={sauver}>
        <div className="grip" />
        <div className="row between">
          <h3>Modifier le prix</h3>
          <button type="button" className="ghost" onClick={fermer}>Fermer</button>
        </div>
        {champ("produit", "Produit")}
        <div className="grid2">
          {champ("marque", "Marque")}
          {champ("format", "Format")}
        </div>
        <label>Catégorie</label>
        <select value={f.categorie} onChange={(e) => setF({ ...f, categorie: e.target.value })}>
          <option value="">Aucune</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          {f.categorie && !CATEGORIES.includes(f.categorie) && <option>{f.categorie}</option>}
        </select>
        <label>Type de produit (icône)</label>
        <select value={f.icone} onChange={(e) => setF({ ...f, icone: e.target.value })}>
          <option value="">Selon la catégorie</option>
          {Object.entries(TYPES_PRODUIT).map(([cle, nom]) => <option key={cle} value={cle}>{nom}</option>)}
        </select>
        <div className="grid2">
          {champ("prix_regulier", "Prix régulier ($)", { inputMode: "decimal" })}
          {champ("prix_unitaire", "Prix unitaire affiché")}
          {champ("prix_promo", "Prix promo ($)", { inputMode: "decimal" })}
          {champ("promo_quantite", "Quantité promo", { inputMode: "numeric" })}
        </div>
        {champ("promo_texte", "Offre")}
        <label className="case">
          <input type="checkbox" checked={membre} onChange={(e) => setMembre(e.target.checked)} />
          Prix réservé aux membres
        </label>
        <div className="grid2">
          {champ("points", "Points de fidélité", { inputMode: "numeric" })}
          {champ("points_details", "Programme, condition")}
        </div>
        <div className="grid2">
          {champ("date_debut", "Début", { type: "date" })}
          {champ("date_fin", "Fin", { type: "date" })}
        </div>
        <label>CUP (code-barres)</label>
        <div className="row">
          <input className="grow" value={f.cup} inputMode="numeric" onChange={(e) => setF({ ...f, cup: e.target.value })} />
          <button type="button" onClick={() => setLecteur(true)}><ICodeBarres /> Scanner</button>
        </div>
        {champ("code_article", "Code article")}
        {champ("notes", "Notes")}
        {photo && (
          <button type="button" className="photo" onClick={() => setAgrandie(true)} aria-label="Agrandir la photo">
            <img src={photo} alt="Photo de la carte de prix" />
            <span>Toucher pour agrandir</span>
          </button>
        )}
        {erreur && <div className="alert" style={{ marginTop: 12 }}>{erreur}</div>}
        <div className="actions">
          <button className="primary full">Enregistrer</button>
          <button type="button" className="full" onClick={() => historique(scan)}>Voir l'historique du produit</button>
          <button type="button" className="danger full" onClick={confirmer ? effacer : () => setConfirmer(true)}>
            {confirmer ? "Confirmer la suppression" : "Supprimer"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Tous les prix relevés pour un même produit, du plus récent au plus ancien. */
export function Historique({ groupe, fermer }: { groupe: Groupe; fermer: () => void }) {
  const obs = groupe.observations;
  return (
    <div className="sheet" onClick={(e) => e.target === e.currentTarget && fermer()}>
      <div className="panel">
        <div className="grip" />
        <div className="row between">
          <h3>Historique</h3>
          <button type="button" className="ghost" onClick={fermer}>Fermer</button>
        </div>
        <div style={{ fontWeight: 600, marginTop: 8 }}>{groupe.nom}</div>
        <div className="muted">{[groupe.marque, groupe.format, groupe.categorie].filter(Boolean).join(" · ") || "Aucun détail"}</div>
        <div style={{ marginTop: 10 }}>
          {obs.map((o, i) => {
            const prix = prixEffectif(o);
            // Variation par rapport au relevé précédent dans la même bannière
            const avant = obs.slice(i + 1).find((p) => p.visites?.banniere === o.visites?.banniere);
            const prixAvant = avant ? prixEffectif(avant) : null;
            const delta = prix !== null && prixAvant !== null ? prix - prixAvant : 0;
            return (
              <div key={o.id} className="tx" style={{ cursor: "default" }}>
                <div className="ic soft">{(o.visites?.banniere || "?").charAt(0).toUpperCase()}</div>
                <div className="mid">
                  <div className="t">{o.visites?.banniere ?? "Visite inconnue"}{o.visites?.magasin ? ` · ${o.visites.magasin}` : ""}</div>
                  <div className="s">{o.visites ? dateLisible(o.visites.date_visite) : ""}</div>
                  {o.prix_promo !== null && <span className="pill promo">Promo</span>}{" "}
                  {Math.abs(delta) >= 0.005 && (
                    <span className={`pill ${delta > 0 ? "hausse" : "baisse"}`}>{delta > 0 ? "Hausse de" : "Baisse de"} {argent(Math.abs(delta))}</span>
                  )}
                </div>
                <div className="r">
                  <b>{argent(prix)}</b>
                  {o.prix_promo !== null && o.prix_regulier !== null && <span className="old">{argent(o.prix_regulier)}</span>}
                </div>
              </div>
            );
          })}
        </div>
        {obs.length === 1 && <div className="muted" style={{ marginTop: 8 }}>Un seul relevé pour l'instant. L'historique se construit à chaque nouvelle visite.</div>}
      </div>
    </div>
  );
}
