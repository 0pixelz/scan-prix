"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { cupNormalise, distanceMetres, grouper, normaliser, prixEffectif, type Groupe } from "@/lib/comparaison";
import { prixParUnite, texteUnite } from "@/lib/unite";
import { TYPES_PRODUIT } from "@/lib/icones";
import { CATEGORIES, type Reference, type Scan, type Visite } from "@/lib/types";
import { chercherImage, cleImage, imageEnGrand, noterEssai, sourceImage } from "@/lib/image";
import Graphique from "./Graphique";
import IconeProduit from "./IconeProduit";
import Visionneuse from "./Visionneuse";
import PromosProduit from "./PromosProduit";
import { distanceLisible, itineraires, magasinsProches, type MagasinProche } from "@/lib/magasins";
import { BANNIERES, ICodeBarres, IPosition, IRecherche, PastilleBanniere, argent, aujourdhui, chargerReferences, chargerTout, dateLisible, logoBanniere } from "./ui";

/** Création d'une visite, ou modification d'une visite existante (bannière, magasin, date). */
export function NouvelleVisite({ visite, connues, fermer, creee, supprimee }: {
  visite?: Visite;
  connues?: Visite[]; // visites déjà faites : leur position sert à reconnaître le magasin
  fermer?: () => void;
  creee: (v: Visite) => void;
  supprimee?: (id: string) => void;
}) {
  const [banniere, setBanniere] = useState(visite?.banniere ?? "");
  const [autre, setAutre] = useState(Boolean(visite && !BANNIERES.includes(visite.banniere)));
  const [magasin, setMagasin] = useState(visite?.magasin ?? "");
  const [date, setDate] = useState(visite?.date_visite ?? aujourdhui());
  const [erreur, setErreur] = useState("");
  const [confirmer, setConfirmer] = useState(false);
  const [position, setPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const [reconnu, setReconnu] = useState<Visite | null>(null);
  const [gps, setGps] = useState<"recherche" | "trouve" | "absent">("recherche");
  const touche = useRef(false); // vrai dès que l'utilisateur choisit lui-même : on ne remplit plus à sa place

  // Nouvelle visite : on lit la position pour reconnaître un magasin déjà visité (à moins de 200 m).
  useEffect(() => {
    if (visite) return;
    if (!navigator.geolocation) return setGps("absent");
    let annule = false;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (annule) return;
        const ici = { latitude: p.coords.latitude, longitude: p.coords.longitude };
        setPosition(ici);
        setGps("trouve");
        const proche = (connues ?? [])
          .filter((v) => typeof v.latitude === "number" && typeof v.longitude === "number")
          .map((v) => ({ v, d: distanceMetres(ici, { latitude: v.latitude!, longitude: v.longitude! }) }))
          .filter((x) => x.d <= 200)
          .sort((a, b) => a.d - b.d)[0]?.v;
        if (proche && !touche.current) {
          setReconnu(proche);
          setBanniere(proche.banniere);
          setAutre(!BANNIERES.includes(proche.banniere));
          setMagasin(proche.magasin ?? "");
        }
        // Dès l'ouverture : les magasins proches de la bannière déjà choisie (reconnue ou par défaut), sans avoir à
        // la toucher. Un magasin reconnu qui a déjà son nom le garde.
        const choisie = !touche.current ? proche?.banniere ?? banniereRef.current : "";
        if (choisie && !(proche?.magasin ?? "").trim()) proposerMagasinsRef.current?.(choisie, ici);
      },
      () => { if (!annule) setGps("absent"); },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enregistrer(e: React.FormEvent) {
    e.preventDefault();
    const valeurs = {
      banniere: banniere.trim(), magasin: magasin.trim() || null, date_visite: date,
      ...(!visite && position ? position : {}),
    };
    const table = supabaseBrowser().from("visites");
    const { data, error } = visite
      ? await table.update(valeurs).eq("id", visite.id).select().single()
      : await table.insert(valeurs).select().single();
    if (error) setErreur(error.message);
    else creee(data as Visite);
  }

  // Une bannière choisie : on propose ses magasins les plus proches (OpenStreetMap). Le plus proche remplit le champ
  // s'il est vide ou s'il venait déjà d'une proposition ; ce que l'utilisateur a tapé lui-même n'est jamais remplacé.
  const [proches, setProches] = useState<MagasinProche[]>([]);
  const [trajet, setTrajet] = useState<string | null>(null); // magasin dont on montre les choix d'itinéraire
  const propose = useRef<string | null>(visite?.magasin ?? null); // magasin venu d'une proposition ou de l'ancienne bannière
  const tape = useRef(false); // vrai dès que le nom du magasin est tapé à la main
  const demande = useRef(0);
  /** Position pour chercher les magasins : celle déjà lue, celle gardée avec la visite, sinon une lecture à la demande. */
  const ou = async (): Promise<{ latitude: number; longitude: number } | null> => {
    if (position) return position;
    if (visite && typeof visite.latitude === "number" && typeof visite.longitude === "number") return { latitude: visite.latitude, longitude: visite.longitude };
    if (!navigator.geolocation) return null;
    return new Promise((resoudre) => navigator.geolocation.getCurrentPosition(
      (p) => resoudre({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => resoudre(null),
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 },
    ));
  };
  async function proposerMagasins(b: string, connue?: { latitude: number; longitude: number }) {
    setProches([]);
    const n = ++demande.current;
    // Le magasin affiché appartenait à l'ancienne bannière : on le retire tout de suite, sauf s'il a été tapé à la main.
    const remplacer = !tape.current;
    if (remplacer) setMagasin("");
    const ici = connue ?? await ou();
    if (n !== demande.current || !ici) return;
    const liste = await magasinsProches(b, ici).catch(() => []);
    if (n !== demande.current) return;
    setProches(liste);
    if (remplacer && liste.length) {
      propose.current = liste[0].nom;
      setMagasin((actuel) => (actuel.trim() ? actuel : liste[0].nom));
    }
  }

  // Accès à la version courante depuis la lecture de position, lancée une seule fois à l'ouverture.
  const proposerMagasinsRef = useRef<typeof proposerMagasins | null>(null);
  proposerMagasinsRef.current = proposerMagasins;
  const banniereRef = useRef(banniere);
  banniereRef.current = banniere;

  // Une bannière choisie : la fenêtre descend jusqu'au bouton « Commencer ».
  const bas = useRef<HTMLDivElement>(null);
  const versLeBas = () => setTimeout(() => bas.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 60);

  async function supprimer() {
    if (!visite) return;
    const { data, error } = await supabaseBrowser().from("visites").delete().eq("id", visite.id).select("id");
    if (error) setErreur(error.message);
    else if (!data?.length) setErreur("Accès en lecture seule : suppression refusée.");
    else supprimee?.(visite.id);
  }

  return (
    <div className="sheet" onClick={(e) => e.target === e.currentTarget && fermer?.()}>
      <form className="panel" onSubmit={enregistrer}>
        <div className="grip" />
        <h3>{visite ? "Modifier la visite" : "Nouvelle visite"}</h3>
        {!visite && (
          <div className={`gps ${reconnu ? "ok" : ""}`}>
            <IPosition />
            {reconnu
              ? `Magasin reconnu : ${reconnu.banniere}${reconnu.magasin ? ` · ${reconnu.magasin}` : ""}`
              : gps === "recherche"
                ? "Recherche de ta position…"
                : gps === "trouve"
                  ? "Position notée : ce magasin sera reconnu à ta prochaine visite."
                  : "Position non disponible : choisis le magasin à la main."}
          </div>
        )}
        <label>Bannière</label>
        <div className="tuiles">
          {BANNIERES.map((b, i) => (
            <button type="button" key={b} className={!autre && banniere === b ? "on" : ""} aria-pressed={!autre && banniere === b} onClick={() => { touche.current = true; setReconnu(null); const change = autre || banniere !== b; setAutre(false); setBanniere(b); versLeBas(); if (change) proposerMagasins(b); }}>
              {logoBanniere(b) ? (
                <img className="logo" src={logoBanniere(b)!} alt="" />
              ) : (
                <span style={{ "--h": (i * 47 + 172) % 360 } as React.CSSProperties}>{b.charAt(0)}</span>
              )}
              {b}
            </button>
          ))}
          <button type="button" className={autre ? "on" : ""} aria-pressed={autre} onClick={() => { touche.current = true; setReconnu(null); setAutre(true); setBanniere(""); demande.current++; setProches([]); if (!tape.current) setMagasin(""); }}>
            <span style={{ "--h": 215 } as React.CSSProperties}>+</span>
            Autre
          </button>
        </div>
        {autre && <input style={{ marginTop: 10 }} value={banniere} onChange={(e) => setBanniere(e.target.value)} placeholder="Nom de la bannière" autoFocus={!visite} />}
        <label>Magasin (ville, succursale)</label>
        <input value={magasin} onChange={(e) => { touche.current = true; tape.current = e.target.value.trim() !== ""; setMagasin(e.target.value); }} placeholder="Ex. Mirabel" />
        {proches.length > 0 && (
          <div className="proches">
            {proches.map((m) => (
              <div className="proche" key={m.nom}>
                <button type="button" className={magasin === m.nom ? "on" : ""} onClick={() => { propose.current = m.nom; tape.current = false; setMagasin(m.nom); }}>
                  {m.nom} <small>{distanceLisible(m.distance)}</small>
                </button>
                <button type="button" className={`aller ${trajet === m.nom ? "on" : ""}`} aria-label={`Itinéraire vers ${m.nom}`} aria-expanded={trajet === m.nom} onClick={() => setTrajet(trajet === m.nom ? null : m.nom)}><IPosition /></button>
                {trajet === m.nom && (
                  <div className="trajet">
                    <a href={itineraires(m, banniere).plans} target="_blank" rel="noopener noreferrer">Plans</a>
                    <a href={itineraires(m, banniere).google} target="_blank" rel="noopener noreferrer">Google Maps</a>
                  </div>
                )}
              </div>
            ))}
            <small>Magasins proches : © OpenStreetMap</small>
          </div>
        )}
        <label>Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        {erreur && <div className="alert" style={{ marginTop: 12 }}>{erreur}</div>}
        <div className="actions" ref={bas}>
          <button className="primary full" disabled={!banniere.trim()}>{visite ? "Enregistrer" : "Commencer"}</button>
          {fermer && <button type="button" className="full" onClick={fermer}>Annuler</button>}
          {visite && (
            <>
              <button type="button" className="danger full" onClick={confirmer ? supprimer : () => setConfirmer(true)}>
                {confirmer ? "Confirmer : supprimer la visite et tous ses prix" : "Supprimer la visite"}
              </button>
              {confirmer && <div className="muted" style={{ textAlign: "center" }}>La visite ira dans la corbeille : tu peux la récupérer pendant 30 jours (Réglages).</div>}
            </>
          )}
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

const CHAMPS_EDITION = ["produit", "marque", "format", "categorie", "icone", "prix_regulier", "prix_promo", "promo_quantite", "promo_texte", "points", "points_details", "date_debut", "date_fin", "cup", "code_article", "prix_unitaire", "prix_unitaire_promo", "notes"];

export function Edition({ scan, fermer, enregistre, supprime, historique, lecture, codePostal, banniere, seuil, promosChange }: {
  scan: Scan;
  codePostal?: string;
  banniere?: string | null; // bannière de la visite : exclue de la recherche des circulaires
  seuil?: number;
  promosChange?: () => void;
  lecture?: boolean;
  fermer: () => void;
  enregistre: (s: Scan, garderOuvert?: boolean) => void;
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
    sb.functions.invoke("photo", { body: { path: scan.photo_path, grande: true } }).then(({ data }) => setPhoto(data?.url ?? null));
  }, [sb, scan.photo_path]);

  const [reference, setReference] = useState<Reference | null>(null);
  useEffect(() => {
    chargerReferences(sb, [scan.cup]).then((r) => setReference(r.get(cupNormalise(scan.cup)) ?? null)).catch(() => {});
  }, [sb, scan.cup]);
  const paye = prixEffectif(scan);
  const unite = prixParUnite(paye, scan.format);

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
      cup: t("cup")?.replace(/\D/g, "") || null, code_article: t("code_article"), prix_unitaire: t("prix_unitaire"), prix_unitaire_promo: t("prix_unitaire_promo"), notes: t("notes"),
      confiance: "haute", // vérifié à la main
    };
    const { data, error } = await sb.from("scans").update(maj).eq("id", scan.id).select().single();
    if (error) setErreur(/row-level|0 rows|PGRST116/i.test(error.message + error.code) ? "Accès en lecture seule : modification refusée." : error.message);
    else enregistre(data as Scan);
  }

  async function effacer() {
    const { data, error } = await sb.from("scans").delete().eq("id", scan.id).select("id");
    if (error) return setErreur(error.message);
    if (!data?.length) return setErreur("Accès en lecture seule : suppression refusée.");
    supprime(scan.id);
  }

  // Photo du vrai produit : celle déjà trouvée, sinon cherchée par le code-barres
  const [imageP, setImageP] = useState<string | null>(scan.image_produit ?? null);
  const [produitAgrandi, setProduitAgrandi] = useState(false);
  const [recherchePhoto, setRecherchePhoto] = useState<"" | "cours" | "rien">("");
  // À l'ouverture de la fiche, la photo est toujours cherchée si elle manque (une fois par session pour un même
  // produit), puis gardée avec le prix pour s'afficher d'emblée les fois suivantes.
  useEffect(() => {
    if (scan.image_produit || !(scan.cup || scan.produit)) return;
    const cle = `scanprix.photo.${cleImage(scan)}`;
    try { if (sessionStorage.getItem(cle)) return; } catch { /* stockage indisponible */ }
    let annule = false;
    setRecherchePhoto("cours");
    chercherImage(sb, scan, codePostal).then(async (url) => {
      if (url !== undefined) {
        noterEssai(cleImage(scan));
        try { sessionStorage.setItem(cle, "1"); } catch { /* stockage indisponible */ }
      }
      if (annule) return;
      setRecherchePhoto("");
      if (!url) return;
      setImageP(url);
      if (!lecture) {
        const { data } = await sb.from("scans").update({ image_produit: url }).eq("id", scan.id).select().single();
        if (data && !annule) enregistre(data as Scan, true);
      }
    });
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan.image_produit, scan.cup, scan.produit, scan.marque, scan.format]);

  // Recherche à la demande : ignore la mémoire des essais (un produit sans photo il y a une semaine peut en avoir une aujourd'hui).
  async function chercherPhoto() {
    setRecherchePhoto("cours");
    const url = await chercherImage(sb, scan, codePostal);
    if (!url) return setRecherchePhoto("rien");
    setRecherchePhoto("");
    setImageP(url);
    if (!lecture) {
      const { data } = await sb.from("scans").update({ image_produit: url }).eq("id", scan.id).select().single();
      if (data) enregistre(data as Scan, true);
    }
  }

  // Mauvaise photo : on la retire, et le produit n'est pas recherché de nouveau avant 7 jours.
  async function retirerImage() {
    noterEssai(cleImage(scan));
    setImageP(null);
    const { data } = await sb.from("scans").update({ image_produit: null }).eq("id", scan.id).select().single();
    if (data) enregistre(data as Scan, true);
  }

  const [offreVue, setOffreVue] = useState<{ image: string; lien: { libelle: string; href: string } } | null>(null);
  if (lecteur) return <ScannerCode fermer={() => setLecteur(false)} lu={(code) => { setF((v) => ({ ...v, cup: code })); setLecteur(false); }} />;
  if (offreVue) return <Visionneuse src={offreVue.image} lien={offreVue.lien} fermer={() => setOffreVue(null)} />;
  if (produitAgrandi && imageP) return <Visionneuse src={imageEnGrand(imageP)} fermer={() => setProduitAgrandi(false)} />;
  if (agrandie && photo) return <Visionneuse src={photo} fermer={() => setAgrandie(false)} />;

  return (
    <div className="sheet" onClick={(e) => e.target === e.currentTarget && fermer()}>
      <form className="panel" onSubmit={sauver}>
        <div className="grip" />
        <div className="row between">
          <h3>Modifier le prix</h3>
          <button type="button" className="ghost" onClick={fermer}>Fermer</button>
        </div>
        {imageP && (
          <div className="entete-produit">
            <button type="button" aria-label="Agrandir la photo du produit" onClick={() => setProduitAgrandi(true)}>
              <img referrerPolicy="no-referrer" src={imageP.replace(/\.200\.jpg$/, ".400.jpg")} alt={`Photo du produit ${scan.produit ?? ""}`} onError={() => setImageP(null)} />
            </button>
            <div>
              <b>{scan.produit || "Produit non lu"}</b>
              <span>{[scan.marque, scan.format].filter(Boolean).join(" · ")}</span>
              <small>Image : {sourceImage(imageP)} · touche pour agrandir</small>
              {!lecture && <button type="button" className="lien" onClick={retirerImage}>Ce n'est pas le bon produit</button>}
            </div>
          </div>
        )}
        {!imageP && (scan.cup || scan.produit) && (
          <button type="button" className="lien chercher-photo" disabled={recherchePhoto === "cours"} onClick={chercherPhoto}>
            {recherchePhoto === "cours" ? "Recherche d'une photo…" : recherchePhoto === "rien" ? "Aucune photo trouvée. Réessayer" : "Chercher une photo du produit"}
          </button>
        )}
        <PromosProduit scan={scan} banniere={banniere ?? null} codePostal={codePostal ?? ""} seuil={seuil ?? 5} lecture={lecture} change={promosChange} voir={(image, lien) => setOffreVue({ image, lien })} />
        {(unite || reference) && (
          <div className="resume">
            {unite && <div><span>Prix par unité</span><b>{texteUnite(unite)}</b></div>}
            {reference && (
              <div>
                <span>Ma référence</span>
                <b>
                  {argent(reference.prix)}
                  {paye !== null && <em className={paye < reference.prix ? "baisse" : paye > reference.prix ? "hausse" : ""}> {paye > reference.prix ? "+" : ""}{(((paye - reference.prix) / reference.prix) * 100).toLocaleString("fr-CA", { maximumFractionDigits: 1 })} %</em>}
                </b>
              </div>
            )}
          </div>
        )}
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
          {champ("prix_unitaire", "Prix unitaire du régulier")}
          {champ("prix_promo", "Prix promo ($)", { inputMode: "decimal" })}
          {champ("prix_unitaire_promo", "Prix unitaire du promo")}
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
          {!lecture && <button className="primary full">Enregistrer</button>}
          <button type="button" className="full" onClick={() => historique(scan)}>Voir l'historique du produit</button>
          {!lecture && (
            <button type="button" className="danger full" onClick={confirmer ? effacer : () => setConfirmer(true)}>
              {confirmer ? "Confirmer la suppression" : "Supprimer"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/** Tous les prix relevés pour un même produit : graphique d'évolution, relevés, et association à un autre produit. */
export function Historique({ groupe: initial, fermer, modifie, lecture }: { groupe: Groupe; fermer: () => void; modifie?: () => void; lecture?: boolean }) {
  const sb = supabaseBrowser();
  const [groupe, setGroupe] = useState(initial);
  const [autres, setAutres] = useState<Groupe[] | null>(null); // autres produits, pour l'association
  const [recherche, setRecherche] = useState("");
  const [erreur, setErreur] = useState("");
  const [occupe, setOccupe] = useState(false);
  const obs = groupe.observations;
  const associe = obs.some((o) => o.groupe_manuel);
  const ici = (g: Groupe) => g.observations.some((o) => o.id === obs[0].id);

  async function ouvrirAssociation() {
    setErreur("");
    try {
      setAutres(grouper(await chargerTout(sb)).filter((g) => !ici(g)).sort((a, b) => a.nom.localeCompare(b.nom, "fr")));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur inconnue");
    }
  }

  /** Écrit la même valeur d'association sur tous les relevés donnés, puis relit le produit. */
  async function ecrire(ids: string[], valeur: string | null) {
    setOccupe(true);
    setErreur("");
    try {
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await sb.from("scans").update({ groupe_manuel: valeur }).in("id", ids.slice(i, i + 100)).select("id");
        if (error) throw new Error(error.message);
        if (!data?.length) throw new Error("Accès en lecture seule : modification refusée.");
      }
      const suite = grouper(await chargerTout(sb)).find(ici);
      if (suite) setGroupe(suite);
      setAutres(null);
      setRecherche("");
      modifie?.();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setOccupe(false);
    }
  }

  const associer = (autre: Groupe) => {
    const tous = [...obs, ...autre.observations];
    return ecrire(tous.map((o) => o.id), tous.find((o) => o.groupe_manuel)?.groupe_manuel ?? crypto.randomUUID());
  };
  const dissocier = () => ecrire(obs.filter((o) => o.groupe_manuel).map((o) => o.id), null);

  if (autres) {
    const mots = normaliser(recherche).split(" ").filter(Boolean);
    const visibles = autres.filter((g) => {
      const texte = normaliser([g.nom, g.marque, g.format, g.cup].filter(Boolean).join(" "));
      return mots.every((m) => texte.includes(m));
    });
    return (
      <div className="sheet" onClick={(e) => e.target === e.currentTarget && setAutres(null)}>
        <div className="panel selection">
          <div className="grip" />
          <div className="row between">
            <h3>Associer à un autre produit</h3>
            <button type="button" className="ghost" onClick={() => setAutres(null)}>Retour</button>
          </div>
          <div className="muted">Choisis le produit qui est le même que « {groupe.nom} ». Leurs prix seront comparés ensemble.</div>
          <div className="search" style={{ marginTop: 12, background: "var(--bg)", boxShadow: "none" }}>
            <IRecherche />
            <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Chercher un produit, une marque, un CUP" />
          </div>
          {erreur && <div className="alert">{erreur}</div>}
          <div className="defile">
            {!visibles.length && <div className="empty"><div>Aucun produit trouvé.</div></div>}
            {visibles.slice(0, 60).map((g) => (
              <div key={g.id} className="tx" role="button" onClick={() => !occupe && associer(g)}>
                <IconeProduit icone={g.icone} categorie={g.categorie} />
                <div className="mid">
                  <div className="t">{g.nom}</div>
                  <div className="s">{[g.marque, g.format, [...new Set(g.observations.map((o) => o.visites?.banniere).filter(Boolean))].join(", ")].filter(Boolean).join(" · ") || "Aucun détail"}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

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
        <Graphique observations={obs} />
        <div style={{ marginTop: 10 }}>
          {obs.map((o, i) => {
            const prix = prixEffectif(o);
            // Variation par rapport au relevé précédent dans la même bannière
            const avant = obs.slice(i + 1).find((p) => p.visites?.banniere === o.visites?.banniere);
            const prixAvant = avant ? prixEffectif(avant) : null;
            const delta = prix !== null && prixAvant !== null ? prix - prixAvant : 0;
            return (
              <div key={o.id} className="tx" style={{ cursor: "default" }}>
                <PastilleBanniere banniere={o.visites?.banniere} doux />
                <div className="mid">
                  <div className="t">{o.visites?.banniere ?? "Visite inconnue"}{o.visites?.magasin ? ` · ${o.visites.magasin}` : ""}</div>
                  <div className="s">{[o.visites ? dateLisible(o.visites.date_visite) : "", o.produit !== groupe.nom ? o.produit : null].filter(Boolean).join(" · ")}</div>
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
        {erreur && <div className="alert" style={{ marginTop: 12 }}>{erreur}</div>}
        {!lecture && (
          <div className="actions">
            <button type="button" className="full" disabled={occupe} onClick={ouvrirAssociation}>Associer à un autre produit</button>
            {associe && <button type="button" className="full ghost" disabled={occupe} onClick={dissocier}>Défaire l'association faite à la main</button>}
            <div className="muted" style={{ textAlign: "center" }}>Utile quand le même produit est écrit différemment d'une bannière à l'autre.</div>
          </div>
        )}
      </div>
    </div>
  );
}
