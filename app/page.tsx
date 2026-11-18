"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { configOk, ecrireJeton, lireJeton, supabaseBrowser } from "@/lib/supabase";
import { correspond, cupNormalise, doublons, grouper, normaliser, prixEffectif, promoUnitaire, variations, type Groupe } from "@/lib/comparaison";
import { ajouterPhoto, photosEnAttente, retirerPhoto, type PhotoEnAttente } from "@/lib/file";
import { prixParUnite, texteUnite } from "@/lib/unite";
import type { ProduitListe, Reference, Scan, Visite } from "@/lib/types";
import Assistant from "./composants/Assistant";
import Code from "./composants/Code";
import Demarrage from "./composants/Demarrage";
import IconeProduit from "./composants/IconeProduit";
import Analyse, { type VueAnalyse } from "./composants/Analyse";
import Revision from "./composants/Revision";
import Liste from "./composants/Liste";
import Rafale from "./composants/Rafale";
import { Edition, Historique, NouvelleVisite } from "./composants/Fenetres";
import {
  IAssistant, ICamera, IComparer, ICrayon, IEtiquette, IExport, IHorsLigne, IJournal, IListe, IMagasin, IPhotos, IPlus, IRecherche,
  PastilleBanniere, argent, aujourdhui, chargerReferences, chargerTout, dateLisible, datePhoto, momentLisible, reduire,
} from "./composants/ui";

type Onglet = "scan" | "liste" | "comparer" | "assistant" | "visites";
type Filtre = "tous" | "promos" | "verifier" | "doublons";

export default function Page() {
  const [acces, setAcces] = useState<"verification" | "code" | "ouvert">("verification");

  // Service worker : l'app peut s'ouvrir sans réseau.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") navigator.serviceWorker?.register("/sw.js").catch(() => {});
  }, []);

  // À l'ouverture : le jeton gardé sur l'appareil est-il encore valide ?
  // L'écran d'ouverture reste affiché au moins une seconde, pour ne pas clignoter.
  useEffect(() => {
    if (!configOk) return;
    const debut = Date.now();
    let fini = false;
    const ouvrir = (etat: "code" | "ouvert") => {
      const attente = Math.max(0, 1100 - (Date.now() - debut));
      setTimeout(() => { if (!fini) setAcces(etat); }, attente);
    };
    if (!lireJeton()) ouvrir("code");
    else {
      supabaseBrowser().rpc("jeton_valide").then(({ data, error }) => {
        if (error) return ouvrir("ouvert"); // hors ligne : on laisse entrer, les données resteront protégées par le serveur
        if (!data) ecrireJeton(null);
        ouvrir(data ? "ouvert" : "code");
      });
    }
    return () => { fini = true; };
  }, []);

  const refuse = useCallback(() => { ecrireJeton(null); setAcces("code"); }, []);

  if (!configOk)
    return (
      <div className="app">
        <header><h1>Scan Prix</h1></header>
        <main><div className="alert">Configuration manquante : ajoute NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY (voir le README).</div></main>
      </div>
    );
  if (acces === "verification") return <Demarrage />;
  if (acces === "code") return <Code ouvert={() => setAcces("ouvert")} />;
  return <App refuse={refuse} />;
}

function App({ refuse }: { refuse: () => void }) {
  const sb = supabaseBrowser();
  const [onglet, setOnglet] = useState<Onglet>("scan");
  const [visites, setVisites] = useState<Visite[]>([]);
  const [visite, setVisite] = useState<Visite | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [liste, setListe] = useState<ProduitListe[]>([]);
  const [enCours, setEnCours] = useState(0); // photos en cours de lecture
  const [enAttente, setEnAttente] = useState(0); // photos gardées sur l'appareil en attendant le réseau
  const [horsLigne, setHorsLigne] = useState(false);
  const [importer, setImporter] = useState(false);
  const [revision, setRevision] = useState(false);
  const [vueAnalyse, setVueAnalyse] = useState<VueAnalyse>("comparer");
  const [refs, setRefs] = useState<Map<string, Reference>>(new Map());
  const [nbVariations, setNbVariations] = useState(0);
  const [erreur, setErreur] = useState("");
  const [edition, setEdition] = useState<Scan | null>(null);
  const [historique, setHistorique] = useState<Groupe | null>(null);
  const [nouvelle, setNouvelle] = useState(false);
  const [rafale, setRafale] = useState(false);
  const [modifVisite, setModifVisite] = useState<Visite | null>(null);
  const [exportEnCours, setExportEnCours] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState<Filtre>("tous");
  const [categorie, setCategorie] = useState("");
  const [confirmerDoublons, setConfirmerDoublons] = useState(false);
  const visiteRef = useRef<Visite | null>(null);
  visiteRef.current = visite;

  // Copie locale des dernières données : l'app reste utilisable sans réseau.
  const lireCache = <T,>(cle: string): T | null => {
    try { return JSON.parse(localStorage.getItem(cle) ?? "null") as T | null; } catch { return null; }
  };
  const ecrireCache = (cle: string, valeur: unknown) => {
    try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch { /* stockage plein ou indisponible */ }
  };

  // Visites : on reprend la plus récente à l'ouverture
  useEffect(() => {
    sb.from("visites").select("*").order("created_at", { ascending: false }).limit(200).then(({ data, error }) => {
      let l = (data ?? []) as Visite[];
      if (error) {
        const cache = lireCache<Visite[]>("scanprix.visites");
        if (!cache) return setErreur(error.message);
        l = cache;
        setHorsLigne(true);
      } else {
        ecrireCache("scanprix.visites", l);
      }
      setVisites(l);
      if (l.length) setVisite(l[0]);
      else setNouvelle(true);
    });
  }, [sb]);

  const chargerScans = useCallback(async () => {
    const v = visiteRef.current;
    if (!v) return setScans([]);
    const { data, error } = await sb.from("scans").select("*").eq("visite_id", v.id).order("created_at", { ascending: false });
    if (visiteRef.current?.id !== v.id) return;
    if (error) {
      const cache = lireCache<{ id: string; scans: Scan[] }>("scanprix.scans");
      if (cache?.id === v.id) setScans(cache.scans);
      else setErreur(error.message);
      return;
    }
    setScans((data ?? []) as Scan[]);
    ecrireCache("scanprix.scans", { id: v.id, scans: data ?? [] });
  }, [sb]);

  const chargerListe = useCallback(async () => {
    const { data, error } = await sb.from("liste_produits").select("*").order("created_at");
    if (error) setListe(lireCache<ProduitListe[]>("scanprix.liste") ?? []);
    else {
      setListe((data ?? []) as ProduitListe[]);
      ecrireCache("scanprix.liste", data ?? []);
    }
  }, [sb]);

  useEffect(() => { chargerScans(); }, [chargerScans, visite]);
  useEffect(() => { chargerListe(); }, [chargerListe]);

  // Prix de référence des produits affichés (par CUP)
  const cups = useMemo(() => [...new Set(scans.map((s) => cupNormalise(s.cup)).filter(Boolean))].sort().join(","), [scans]);
  useEffect(() => {
    if (!cups) return setRefs(new Map());
    let annule = false;
    chargerReferences(sb, cups.split(",")).then((r) => { if (!annule) setRefs(r); }).catch(() => {});
    return () => { annule = true; };
  }, [sb, cups]);

  // Changements de prix de cette visite par rapport à la visite précédente dans la même bannière
  const visiteId = visite?.id;
  useEffect(() => {
    setNbVariations(0);
    if (!visiteId || enCours > 0) return;
    let annule = false;
    chargerTout(sb)
      .then((tout) => { if (!annule) setNbVariations(variations(grouper(tout)).filter((c) => c.apres.visite_id === visiteId).length); })
      .catch(() => {});
    return () => { annule = true; };
  }, [sb, visiteId, enCours]);

  // File d'attente des photos, gardée sur l'appareil : chaque photo y reste jusqu'à ce qu'elle soit lue.
  // Trois lectures à la fois au maximum ; sans réseau, les photos attendent et repartent toutes seules.
  const traitement = useRef(new Set<string>());
  const memoire = useRef(new Map<string, PhotoEnAttente>()); // secours si le stockage de l'appareil est indisponible

  const compter = useCallback(async () => {
    let total = memoire.current.size;
    try { total += (await photosEnAttente()).length; } catch { /* stockage indisponible */ }
    setEnCours(traitement.current.size);
    setEnAttente(Math.max(0, total - traitement.current.size));
  }, []);

  const traiterFile = useCallback(async () => {
    let photos: PhotoEnAttente[] = [...memoire.current.values()];
    try { photos = [...photos, ...(await photosEnAttente())]; } catch { /* stockage indisponible */ }

    const lire = async (p: PhotoEnAttente) => {
      traitement.current.add(p.id);
      compter();
      let reseauCoupe = false;
      const retirer = async () => {
        memoire.current.delete(p.id);
        await retirerPhoto(p.id).catch(() => {});
      };
      try {
        const { data: json, error } = await sb.functions.invoke("scan", {
          body: { image: p.image, visiteId: p.visiteId, mode: p.mode, priseLe: p.priseLe },
        });
        if (error) {
          // Pas de réseau : la photo reste en attente. Autre panne du service : on le dit, et la photo reste aussi.
          reseauCoupe = true;
          setHorsLigne(true);
          if (error.name !== "FunctionsFetchError" && navigator.onLine) setErreur("Service de lecture indisponible. Les photos restent en attente.");
          return;
        }
        setHorsLigne(false);
        if (json.acces === false) {
          reseauCoupe = true; // code à entrer de nouveau : la photo reste en attente
          return refuse();
        }
        await retirer();
        if (json.error) throw new Error(json.error);
        if (!json.scans.length) setErreur(json.message || "Aucune carte de prix lisible.");
        else {
          if (visiteRef.current?.id === p.visiteId) setScans((s) => [...(json.scans as Scan[]), ...s]);
          // Photo en haute résolution, gardée pour le zoom
          const chemin = (json.scans as Scan[])[0]?.photo_path;
          if (p.originale && chemin) sb.functions.invoke("photo", { body: { path: chemin, originale: p.originale } }).catch(() => {});
        }
      } catch (e) {
        setErreur(e instanceof Error ? e.message : "Erreur inconnue");
      } finally {
        traitement.current.delete(p.id);
        await compter();
        if (!reseauCoupe) traiterFile();
      }
    };

    for (const p of photos) {
      if (traitement.current.size >= 3) break;
      if (!traitement.current.has(p.id)) lire(p);
    }
    compter();
  }, [sb, compter, refuse]);

  // Relance : à l'ouverture, au retour du réseau, et toutes les 20 secondes s'il reste des photos en attente.
  useEffect(() => {
    traiterFile();
    const retour = () => { setHorsLigne(false); traiterFile(); chargerScans(); };
    const coupure = () => setHorsLigne(true);
    window.addEventListener("online", retour);
    window.addEventListener("offline", coupure);
    const minuterie = setInterval(() => { if (navigator.onLine) traiterFile(); }, 20000);
    return () => {
      window.removeEventListener("online", retour);
      window.removeEventListener("offline", coupure);
      clearInterval(minuterie);
    };
  }, [traiterFile, chargerScans]);

  async function photographier(files: FileList | File[] | null, mode: "carte" | "circulaire" = "carte") {
    const v = visiteRef.current;
    if (!files?.length || !v) return;
    setErreur("");
    for (const fichier of Array.from(files)) {
      try {
        const [{ image, originale }, priseLe] = await Promise.all([reduire(fichier), datePhoto(fichier)]);
        const p: PhotoEnAttente = { id: crypto.randomUUID(), visiteId: v.id, image, originale, priseLe, mode };
        await ajouterPhoto(p).catch(() => { memoire.current.set(p.id, p); });
      } catch {
        setErreur("Photo illisible : elle n'a pas été ajoutée.");
      }
    }
    traiterFile();
  }

  async function exporter(v: Visite | null) {
    setExportEnCours(true);
    setErreur("");
    try {
      const res = await fetch(`/api/export${v ? `?visite=${v.id}` : ""}`, { headers: { "x-jeton": lireJeton() ?? "" } });
      if (res.status === 401) return refuse();
      if (!res.ok) throw new Error((await res.json()).error || "Export impossible");
      const blob = await res.blob();
      const nom = v
        ? `prix-${v.banniere.toLowerCase().replace(/\s+/g, "-")}-${v.date_visite}.xlsx`
        : `prix-tout-${aujourdhui()}.xlsx`;
      const fichier = new File([blob], nom, { type: blob.type });
      // Sur iPhone : feuille de partage (Enregistrer dans Fichiers, Courriel, Excel…)
      if (navigator.canShare?.({ files: [fichier] })) {
        await navigator.share({ files: [fichier] }).catch(() => {});
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = nom;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setExportEnCours(false);
    }
  }

  async function ouvrirHistorique(s: Scan) {
    try {
      const groupe = grouper(await chargerTout(sb)).find((g) => g.observations.some((o) => o.id === s.id));
      if (groupe) {
        setEdition(null);
        setHistorique(groupe);
      }
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur inconnue");
    }
  }

  const enDouble = useMemo(() => doublons(scans), [scans]);

  async function supprimerDoublons() {
    const ids = [...enDouble];
    const { error } = await sb.from("scans").delete().in("id", ids);
    if (error) return setErreur(error.message);
    setScans((l) => l.filter((s) => !enDouble.has(s.id)));
    setConfirmerDoublons(false);
    setFiltre("tous");
  }

  const nbPromos = scans.filter((s) => s.prix_promo !== null).length;
  const nbVerif = scans.filter((s) => s.confiance && s.confiance !== "haute").length;
  const categories = [...new Set(scans.map((s) => s.categorie).filter(Boolean))].sort() as string[];
  const mots = normaliser(recherche).split(" ").filter(Boolean);
  const visibles = scans.filter((s) => {
    if (filtre === "promos" && s.prix_promo === null) return false;
    if (filtre === "verifier" && (!s.confiance || s.confiance === "haute")) return false;
    if (filtre === "doublons" && !enDouble.has(s.id)) return false;
    if (categorie && s.categorie !== categorie) return false;
    if (!mots.length) return true;
    const texte = normaliser([s.produit, s.marque, s.format, s.cup, s.code_article, s.categorie].filter(Boolean).join(" "));
    return mots.every((m) => texte.includes(m));
  });
  const titres: Record<Onglet, string> = { scan: "Scan Prix", liste: "Liste", comparer: "Analyse", assistant: "Assistant", visites: "Visites" };
  const aVerifier = scans.filter((s) => s.confiance && s.confiance !== "haute");
  const puce = (f: Filtre, libelle: string, n: number) => (
    <button className={filtre === f ? "on" : ""} onClick={() => setFiltre(f)}>{libelle} ({n})</button>
  );

  return (
    <div className="app">
      <header>
        <h1>{titres[onglet]}</h1>
        {onglet === "scan" && visite && (
          <button className="small" disabled={exportEnCours || !scans.length} onClick={() => exporter(visite)}>
            <IExport /> Excel
          </button>
        )}
        {onglet === "visites" && (
          <button className="small" onClick={() => setNouvelle(true)}><IPlus /> Nouvelle</button>
        )}
      </header>

      {onglet === "scan" && (
        <main className="withfab">
          {erreur && <div className="alert" onClick={() => setErreur("")}>{erreur}</div>}

          <div className="card visite">
            {visite && <PastilleBanniere banniere={visite.banniere} doux />}
            {!visite && <div className="ic soft"><IMagasin /></div>}
            <div className="grow">
              <div className="muted">Visite en cours</div>
              {visites.length ? (
                <select value={visite?.id ?? ""} onChange={(e) => setVisite(visites.find((v) => v.id === e.target.value) ?? null)}>
                  {visites.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.banniere}{v.magasin ? ` · ${v.magasin}` : ""} · {dateLisible(v.date_visite)}
                    </option>
                  ))}
                </select>
              ) : (
                <b>Aucune visite</b>
              )}
            </div>
            {visite && <button className="ghost icone" aria-label="Modifier la visite" onClick={() => setModifVisite(visite)}><ICrayon /></button>}
            <button className="ghost icone" aria-label="Nouvelle visite" onClick={() => setNouvelle(true)}><IPlus /></button>
          </div>

          {visite && (
            <>
              <div className="stats">
                <div className="stat"><small>Prix</small><b>{scans.length}</b></div>
                <div className="stat"><small>Promos</small><b>{nbPromos}</b></div>
                <button className={`stat ${nbVerif ? "action" : ""}`} disabled={!nbVerif} onClick={() => setRevision(true)}>
                  <small>À vérifier</small><b>{nbVerif}</b>{nbVerif > 0 && <em>Réviser</em>}
                </button>
              </div>

              {(horsLigne || enAttente > 0) && (
                <div className="alert avis">
                  <span className="row"><IHorsLigne />
                    {enAttente > 0
                      ? `${horsLigne ? "Hors ligne : " : ""}${enAttente} photo${enAttente > 1 ? "s" : ""} en attente. ${horsLigne ? "Elles seront lues au retour du réseau." : "Lecture à venir."}`
                      : "Hors ligne : les photos seront gardées et lues au retour du réseau."}
                  </span>
                  {enAttente > 0 && navigator.onLine && <button className="small" onClick={() => traiterFile()}>Réessayer</button>}
                </div>
              )}
              {enCours > 0 && <div className="alert info">Lecture de {enCours} photo{enCours > 1 ? "s" : ""} en cours…</div>}

              {nbVariations > 0 && (
                <div className="card lien" role="button" onClick={() => { setVueAnalyse("variations"); setOnglet("comparer"); }}>
                  <div className="ic soft"><IComparer /></div>
                  <div className="grow">
                    <b>{nbVariations} changement{nbVariations > 1 ? "s" : ""} de prix</b>
                    <div className="muted">Depuis ta visite précédente chez {visite.banniere}</div>
                  </div>
                </div>
              )}

              {enDouble.size > 0 && (
                <div className="alert avis">
                  <span>{enDouble.size} doublon{enDouble.size > 1 ? "s" : ""} dans cette visite.</span>
                  {confirmerDoublons ? (
                    <button className="small danger" onClick={supprimerDoublons}>Confirmer la suppression</button>
                  ) : (
                    <span className="row">
                      <button className="small" onClick={() => setFiltre("doublons")}>Voir</button>
                      <button className="small" onClick={() => setConfirmerDoublons(true)}>Supprimer</button>
                    </span>
                  )}
                </div>
              )}

              {liste.length > 0 && (
                <div className="card lien" role="button" onClick={() => setOnglet("liste")}>
                  <div className="ic soft"><IListe /></div>
                  <div className="grow">
                    <b>Liste à relever</b>
                    <div className="muted">
                      {(() => {
                        const reste = liste.filter((p) => !scans.some((s) => correspond(p, s))).length;
                        return reste ? `${reste} produit${reste > 1 ? "s" : ""} à trouver sur ${liste.length}` : "Tous les produits sont relevés";
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {scans.length > 0 && (
                <>
                  <div className="search">
                    <IRecherche />
                    <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Chercher un produit, une marque, un code" />
                  </div>
                  <div className="chips">
                    {puce("tous", "Tous", scans.length)}
                    {puce("promos", "Promos", nbPromos)}
                    {puce("verifier", "À vérifier", nbVerif)}
                    {enDouble.size > 0 && puce("doublons", "Doublons", enDouble.size)}
                    {categories.length > 0 && (
                      <select value={categorie} onChange={(e) => setCategorie(e.target.value)} aria-label="Catégorie">
                        <option value="">Toutes les catégories</option>
                        {categories.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    )}
                  </div>
                </>
              )}

              <div className="card">
                <h2>Prix relevés</h2>
                {!scans.length && (
                  <div className="empty">
                    <IEtiquette />
                    <div>Aucun prix pour l'instant.</div>
                    <div className="muted">Photographie une carte de prix, ou importe des photos déjà prises.</div>
                  </div>
                )}
                {scans.length > 0 && !visibles.length && <div className="empty"><div>Aucun prix ne correspond.</div></div>}
                {visibles.map((s) => {
                  const pu = promoUnitaire(s);
                  const unite = prixParUnite(prixEffectif(s), s.format);
                  const ref = refs.get(cupNormalise(s.cup));
                  const ecartRef = ref && prixEffectif(s) !== null ? ((prixEffectif(s)! - ref.prix) / ref.prix) * 100 : null;
                  return (
                    <div key={s.id} className="tx" role="button" onClick={() => setEdition(s)}>
                      <IconeProduit icone={s.icone} categorie={s.categorie} />
                      <div className="mid">
                        <div className="t">{s.produit || "Produit non lu"}</div>
                        <div className="s">{[s.marque, s.format, s.categorie].filter(Boolean).join(" · ") || "Aucun détail"}</div>
                        <div className="s">{[momentLisible(s.photo_prise_le ?? s.created_at), visite.banniere, visite.magasin].filter(Boolean).join(" · ")}</div>
                        {s.prix_promo !== null && (
                          <span className="pill promo">
                            {s.promo_quantite && s.promo_quantite > 1 ? `${s.promo_quantite} pour ${argent(s.prix_promo)}` : "Promo"}
                            {s.date_fin ? ` · jusqu'au ${dateLisible(s.date_fin)}` : ""}
                          </span>
                        )}{" "}
                        {s.source === "circulaire" && <span className="pill membre">Circulaire</span>}{" "}
                        {ecartRef !== null && (
                          <span className={`pill ${ecartRef < -0.05 ? "baisse" : ecartRef > 0.05 ? "hausse" : "membre"}`}>
                            Réf. {argent(ref!.prix)} · {ecartRef > 0 ? "+" : ""}{ecartRef.toLocaleString("fr-CA", { maximumFractionDigits: 1 })} %
                          </span>
                        )}{" "}
                        {s.prix_membre && <span className="pill membre">Prix membre</span>}{" "}
                        {s.points ? <span className="pill pts">{s.points.toLocaleString("fr-CA")} points</span> : null}{" "}
                        {s.confiance && s.confiance !== "haute" && <span className="pill verif">À vérifier</span>}{" "}
                        {enDouble.has(s.id) && <span className="pill verif">Doublon</span>}
                      </div>
                      <div className="r">
                        <b>{argent(pu ?? s.prix_regulier)}</b>
                        {pu !== null && s.prix_regulier !== null && <span className="old">{argent(s.prix_regulier)}</span>}
                        {unite && <small>{texteUnite(unite)}</small>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </main>
      )}

      {onglet === "liste" && <Liste liste={liste} scans={scans} visite={visite} recharger={chargerListe} />}

      {onglet === "comparer" && <Analyse key={vueAnalyse} historique={setHistorique} vueInitiale={vueAnalyse} visiteId={visite?.id ?? null} refuse={refuse} />}

      {onglet === "assistant" && <Assistant visite={visite} modifie={() => { chargerScans(); chargerListe(); }} refuse={refuse} />}

      {onglet === "visites" && (
        <main>
          {erreur && <div className="alert" onClick={() => setErreur("")}>{erreur}</div>}
          <div className="card">
            <h2>Mes visites</h2>
            {!visites.length && <div className="empty"><IMagasin /><div>Aucune visite.</div></div>}
            {visites.map((v) => (
              <div key={v.id} className="tx" role="button" onClick={() => { setVisite(v); setOnglet("scan"); }}>
                <PastilleBanniere banniere={v.banniere} doux={v.id !== visite?.id} />
                <div className="mid">
                  <div className="t">{v.banniere}{v.magasin ? ` · ${v.magasin}` : ""}</div>
                  <div className="s">{dateLisible(v.date_visite)}{v.id === visite?.id ? " · en cours" : ""}</div>
                </div>
                <button className="ghost icone" aria-label={`Modifier la visite ${v.banniere}`} onClick={(e) => { e.stopPropagation(); setModifVisite(v); }}><ICrayon /></button>
                <button className="small" disabled={exportEnCours} onClick={(e) => { e.stopPropagation(); exporter(v); }}>
                  <IExport /> Excel
                </button>
              </div>
            ))}
          </div>
          <button className="full" disabled={exportEnCours || !visites.length} onClick={() => exporter(null)}>
            <IExport /> Exporter toutes les visites
          </button>
          <button className="full ghost" style={{ marginTop: 10 }} onClick={refuse}>Verrouiller l'app</button>
        </main>
      )}

      {onglet === "scan" && visite && (
        <div className="fab">
          <div className="fabrow">
            <button className="principal" onClick={() => setRafale(true)}>
              <ICamera /> Photographier
            </button>
            <button className="secondaire" onClick={() => setImporter(true)}>
              <IPhotos /> Importer
            </button>
          </div>
        </div>
      )}

      <nav>
        <button className={onglet === "scan" ? "on" : ""} onClick={() => setOnglet("scan")}><IEtiquette />Prix</button>
        <button className={onglet === "liste" ? "on" : ""} onClick={() => setOnglet("liste")}><IListe />Liste</button>
        <button className={onglet === "comparer" ? "on" : ""} onClick={() => { setVueAnalyse("comparer"); setOnglet("comparer"); }}><IComparer />Analyse</button>
        <button className={onglet === "assistant" ? "on" : ""} onClick={() => setOnglet("assistant")}><IAssistant />Assistant</button>
        <button className={onglet === "visites" ? "on" : ""} onClick={() => setOnglet("visites")}><IMagasin />Visites</button>
      </nav>

      {nouvelle && (
        <NouvelleVisite
          connues={visites}
          fermer={visites.length ? () => setNouvelle(false) : undefined}
          creee={(v) => { setVisites((l) => [v, ...l]); setVisite(v); setNouvelle(false); setOnglet("scan"); }}
        />
      )}

      {modifVisite && (
        <NouvelleVisite
          visite={modifVisite}
          fermer={() => setModifVisite(null)}
          creee={(v) => {
            setVisites((l) => l.map((x) => (x.id === v.id ? v : x)));
            if (visite?.id === v.id) setVisite(v);
            setModifVisite(null);
          }}
          supprimee={(id) => {
            const reste = visites.filter((x) => x.id !== id);
            setVisites(reste);
            if (visite?.id === id) {
              setVisite(reste[0] ?? null);
              if (!reste.length) setNouvelle(true);
            }
            setModifVisite(null);
          }}
        />
      )}

      {edition && (
        <Edition
          scan={edition}
          fermer={() => setEdition(null)}
          enregistre={(s) => { setScans((l) => l.map((x) => (x.id === s.id ? s : x))); setEdition(null); }}
          supprime={(id) => { setScans((l) => l.filter((x) => x.id !== id)); setEdition(null); }}
          historique={ouvrirHistorique}
        />
      )}

      {importer && (
        <div className="sheet" onClick={(e) => e.target === e.currentTarget && setImporter(false)}>
          <div className="panel">
            <div className="grip" />
            <div className="row between">
              <h3>Importer</h3>
              <button type="button" className="ghost" onClick={() => setImporter(false)}>Fermer</button>
            </div>
            <div className="choix">
              <label>
                <div className="ic soft"><IPhotos /></div>
                <span><b>Photos de cartes de prix</b><small>Une ou plusieurs photos déjà prises avec ton téléphone.</small></span>
                <input type="file" accept="image/*" multiple onChange={(e) => { photographier(e.target.files); e.target.value = ""; setImporter(false); }} />
              </label>
              <label>
                <div className="ic soft"><IJournal /></div>
                <span><b>Page de circulaire</b><small>Photo ou capture d'une page : tous les prix de la page sont lus d'un coup. Cadre une demi-page à la fois pour les petits caractères.</small></span>
                <input type="file" accept="image/*" multiple onChange={(e) => { photographier(e.target.files, "circulaire"); e.target.value = ""; setImporter(false); }} />
              </label>
            </div>
          </div>
        </div>
      )}

      {revision && (
        <Revision
          scans={aVerifier}
          fermer={() => setRevision(false)}
          modifie={(m) => setScans((l) => l.map((x) => (x.id === m.id ? m : x)))}
        />
      )}

      {rafale && <Rafale fermer={() => setRafale(false)} photo={photographier} enCours={enCours} />}

      {historique && <Historique groupe={historique} fermer={() => setHistorique(null)} />}
    </div>
  );
}
