"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { adopterAppareil, configOk, ecrireJeton, jetonInvitation, lireJeton, oublierInvitation, ouvrirInvitation, preparerInstallation, supabaseBrowser } from "@/lib/supabase";
import { alertes, comparer, correspond, cupNormalise, doublons, grouper, normaliser, prixEffectif, promoUnitaire, variations, type Groupe, type LigneComparaison } from "@/lib/comparaison";
import { appliquerApparence, lireApparence, type Apparence } from "@/lib/apparence";
import { filigraner } from "@/lib/filigrane";
import { chercherImage, cleImage, dejaEssaye, noterEssai } from "@/lib/image";
import { ajouterPhoto, photosEnAttente, retirerPhoto, type PhotoEnAttente } from "@/lib/file";
import { prixParUnite, texteUnite } from "@/lib/unite";
import { REGLAGES_DEFAUT, lireReglages, type Acces, type ListeNom, type ProduitListe, type Reference, type Reglages as TReglages, type Scan, type ScanAvecVisite, type Visite } from "@/lib/types";
import Reglages, { type Section } from "./composants/Reglages";
import { ChoixVisite, MenuExport, RechercheGlobale } from "./composants/Menus";
import { Fantomes, Glissable, Principal } from "./composants/Gestes";
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
  IAssistant, ICamera, IComparer, ICrayon, IEffacer, IPlusMenu, IReglages, IEtiquette, IExport, IPartage, IPoubelle, IChevron, IHorsLigne, IJournal, IListe, IMagasin, IPhotos, IPlus, IRecherche,
  PastilleBanniere, argent, aujourdhui, chargerReferences, chargerTout, dateLisible, datePhoto, momentLisible, reduire,
  logoBanniere,
} from "./composants/ui";
import { clePromo, pctLisible } from "@/lib/promos";

type Onglet = "scan" | "liste" | "comparer" | "plus" | "assistant" | "visites" | "reglages";
type Filtre = "tous" | "promos" | "verifier" | "doublons";

export default function Page() {
  const [acces, setAcces] = useState<"verification" | "code" | "ouvert">("verification");
  const [avisCode, setAvisCode] = useState(""); // message affiché à l'écran du code (lien d'invitation refusé)

  // Thème et taille du texte choisis sur cet appareil, appliqués avant le premier affichage
  useLayoutEffect(() => { appliquerApparence(lireApparence(), false); }, []);

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
    // Lien d'invitation (« …/#inv=… ») : ouvre l'app sans code, y compris depuis l'écran d'accueil.
    const invitation = jetonInvitation(window.location.hash);
    adopterAppareil(window.location.hash);
    if (invitation && !lireJeton()) {
      ouvrirInvitation(invitation).then((r) => {
        if (r === "ok") preparerInstallation();
        else if (r === "invalide") history.replaceState(null, "", window.location.pathname + window.location.search);
        if (r !== "ok") setAvisCode(r === "bloque" ? "Trop d'essais. Réessaie dans 15 minutes." : r === "reseau" ? "Connexion impossible. Rouvre le lien quand tu as du réseau." : "Ce lien d'invitation n'est plus actif. Demande-en un nouveau.");
        ouvrir(r === "ok" ? "ouvert" : "code");
      });
    } else if (!lireJeton()) ouvrir("code");
    else {
      supabaseBrowser().rpc("jeton_valide").then(({ data, error }) => {
        if (error) return ouvrir("ouvert"); // hors ligne : on laisse entrer, les données resteront protégées par le serveur
        if (!data) {
          ecrireJeton(null);
          oublierInvitation();
          if (invitation) history.replaceState(null, "", window.location.pathname + window.location.search);
        } else preparerInstallation();
        ouvrir(data ? "ouvert" : "code");
      });
    }
    return () => { fini = true; };
  }, []);

  const refuse = useCallback(() => { ecrireJeton(null); setAvisCode(""); setAcces("code"); }, []);

  if (!configOk)
    return (
      <div className="app">
        <header><h1>Scan Prix</h1></header>
        <main><div className="alert">Configuration manquante : ajoute NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY (voir le README).</div></main>
      </div>
    );
  if (acces === "verification") return <Demarrage />;
  if (acces === "code") return <Code ouvert={() => setAcces("ouvert")} avis={avisCode} />;
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
  const [vueAnalyse, setVueAnalyse] = useState<VueAnalyse>("accueil");
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
  const [confirmerDoublons, setConfirmerDoublons] = useState(false);
  const visiteRef = useRef<Visite | null>(null);
  visiteRef.current = visite;
  const [listes, setListes] = useState<ListeNom[]>([]);
  const [listeId, setListeId] = useState<string | null>(() => { try { return localStorage.getItem("scanprix.listeId"); } catch { return null; } });
  const [reglages, setReglages] = useState<TReglages>(REGLAGES_DEFAUT);
  const reglagesRef = useRef(reglages);
  reglagesRef.current = reglages;
  const [acces, setAcces] = useState<Acces | null>(null);
  const [ouvrirReglages, setOuvrirReglages] = useState<Section | null>(null);
  const [menu, setMenu] = useState<null | "visite" | "export" | "recherche">(null); // fenêtres ouvertes depuis l'en-tête
  const [annulable, setAnnulable] = useState<{ objetId: string; texte: string } | null>(null);
  const [tout, setTout] = useState<ScanAvecVisite[] | null>(null); // tous les prix, pour la recherche dans les autres visites
  const [version, setVersion] = useState(0); // augmente quand les données changent ailleurs que dans la visite en cours
  const [rapportEnCours, setRapportEnCours] = useState(false);
  const lecture = acces?.role === "lecture";
  const [apparence, setApparence] = useState<Apparence>(lireApparence);
  const [secours, setSecours] = useState<{ lecteur: "claude" | "gemini"; panne: string } | null>(null); // le lecteur choisi a échoué : l'autre a lu
  const [chargement, setChargement] = useState(true); // premier chargement des prix de la visite
  const [comparaison, setComparaison] = useState<LigneComparaison[]>([]);
  const [replies, setReplies] = useState<Set<string>>(new Set()); // catégories repliées
  const [vignette, setVignette] = useState<{ image: string; texte: string; prix: string } | null>(null);

  // Copie locale des dernières données : l'app reste utilisable sans réseau.
  const lireCache = <T,>(cle: string): T | null => {
    try { return JSON.parse(localStorage.getItem(cle) ?? "null") as T | null; } catch { return null; }
  };
  const ecrireCache = (cle: string, valeur: unknown) => {
    try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch { /* stockage plein ou indisponible */ }
  };

  // Réglages (signature des photos, seuil d'alerte, tarifs) et type d'accès
  const chargerAcces = useCallback(() => {
    sb.rpc("etat_acces").then(({ data }) => {
      if (!data) return;
      const a = data as Acces;
      // Session collègue sans espace privé (ouverte par une ancienne version) : on redemande le code.
      if (a.role && !a.proprietaire && a.espace === false) return refuse();
      setAcces(a);
    });
  }, [sb, refuse]);
  useEffect(() => {
    const cache = lireCache<unknown>("scanprix.reglages");
    if (cache) setReglages(lireReglages(cache));
    sb.from("reglages").select("donnees").eq("id", 1).maybeSingle().then(({ data }) => {
      if (!data) return;
      setReglages(lireReglages(data.donnees));
      ecrireCache("scanprix.reglages", data.donnees);
    });
    chargerAcces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb, chargerAcces]);

  const enregistrerReglages = useCallback(async (r: TReglages): Promise<string | null> => {
    const { data, error } = await sb.from("reglages").upsert({ id: 1, donnees: r, modifie_le: new Date().toISOString() }).select("id");
    if (error || !data?.length) return /row-level/i.test(error?.message ?? "row-level") ? "Seul le code principal peut modifier les réglages." : error!.message;
    setReglages(r);
    try { localStorage.setItem("scanprix.reglages", JSON.stringify(r)); } catch { /* stockage indisponible */ }
    return null;
  }, [sb]);

  // Promos de circulaires gardées (dernières recherches) : affichées sur chaque prix, avec le logo des concurrents.
  const [promosGardees, setPromosGardees] = useState<Map<string, { banniere: string; prix: number; ecart: number | null }[]>>(new Map());
  const chargerPromos = useCallback(async () => {
    const { data } = await sb.from("promos_circulaires").select("visite_id, produit, marque, cup, banniere, prix, ecart_pct, fin").limit(2000);
    const m = new Map<string, { banniere: string; prix: number; ecart: number | null }[]>();
    for (const p of (data ?? []) as { visite_id: string | null; produit: string; marque: string | null; cup: string | null; banniere: string; prix: number; ecart_pct: number | null; fin: string | null }[]) {
      if (p.fin && Date.parse(p.fin) < Date.now()) continue;
      const k = `${p.visite_id ?? ""}|${clePromo(p)}`;
      const l = m.get(k) ?? [];
      if (!l.some((x) => x.banniere === p.banniere)) l.push({ banniere: p.banniere, prix: Number(p.prix), ecart: p.ecart_pct === null ? null : Number(p.ecart_pct) });
      m.set(k, l);
    }
    for (const l of m.values()) l.sort((a, b) => (a.ecart ?? 999) - (b.ecart ?? 999)); // la meilleure offre d'abord
    setPromosGardees(m);
  }, [sb]);
  useEffect(() => { if (onglet === "scan") chargerPromos(); }, [chargerPromos, onglet]);

  const chargerVisites = useCallback(async () => {
    const { data } = await sb.from("visites").select("*").order("created_at", { ascending: false }).limit(200);
    if (data) setVisites(data as Visite[]);
    return (data ?? []) as Visite[];
  }, [sb]);

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
    const requete = sb.from("liste_produits").select("*").order("created_at");
    const { data, error } = await (listeId ? requete.eq("liste_id", listeId) : requete.is("liste_id", null));
    const cache = lireCache<{ id: string | null; produits: ProduitListe[] }>("scanprix.liste");
    if (error) setListe(cache && !Array.isArray(cache) && cache.id === listeId ? cache.produits : []);
    else {
      setListe((data ?? []) as ProduitListe[]);
      ecrireCache("scanprix.liste", { id: listeId, produits: data ?? [] });
    }
  }, [sb, listeId]);

  const chargerListes = useCallback(async () => {
    const { data, error } = await sb.from("listes").select("*").order("created_at");
    if (error) return;
    setListes((data ?? []) as ListeNom[]);
    // La liste choisie n'existe plus (supprimée sur un autre appareil) : retour à la liste principale
    setListeId((id) => (id && !(data ?? []).some((l) => l.id === id) ? null : id));
  }, [sb]);
  useEffect(() => { chargerListes(); }, [chargerListes]);
  useEffect(() => {
    try { if (listeId) localStorage.setItem("scanprix.listeId", listeId); else localStorage.removeItem("scanprix.listeId"); } catch { /* stockage indisponible */ }
  }, [listeId]);

  useEffect(() => {
    setChargement(true);
    chargerScans().finally(() => setChargement(false));
  }, [chargerScans, visite]);
  useEffect(() => { chargerListe(); }, [chargerListe]);

  // Image du vrai produit pour les prix qui n'en ont pas : Google Images, circulaire, puis bases ouvertes.
  // Un produit cherché sans succès n'est pas recherché de nouveau avant 7 jours (quota du service d'images).
  useEffect(() => {
    let annule = false;
    (async () => {
      const aChercher = scans.filter((x) => !x.image_produit && (x.cup || (x.marque && x.produit)) && !dejaEssaye(cleImage(x)));
      for (const s of aChercher.filter((x, i) => aChercher.findIndex((y) => cleImage(y) === cleImage(x)) === i).slice(0, 10)) {
        if (annule || !navigator.onLine) return;
        const url = await chercherImage(sb, s, reglagesRef.current.codePostal);
        if (url === undefined) return; // service occupé : on réessaiera à la prochaine ouverture
        noterEssai(cleImage(s));
        if (url && !annule) {
          setScans((l) => l.map((x) => (cleImage(x) === cleImage(s) && !x.image_produit ? { ...x, image_produit: url } : x)));
          if (!lecture) {
            const maj = sb.from("scans").update({ image_produit: url }).eq("visite_id", s.visite_id).is("image_produit", null);
            (s.cup ? maj.eq("cup", s.cup) : maj.eq("id", s.id)).then(() => {});
          }
        }
        await new Promise((r) => setTimeout(r, 600));
      }
    })();
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb, scans.length, visite?.id, lecture]);

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
      .then((tout) => {
        if (annule) return;
        const groupes = grouper(tout);
        setNbVariations(variations(groupes).filter((c) => c.apres.visite_id === visiteId).length);
        setComparaison(comparer(groupes));
      })
      .catch(() => {});
    return () => { annule = true; };
  }, [sb, visiteId, enCours, version, scans.length]);

  // Alertes de cette visite : écarts au-dessus du seuil, par rapport à la référence et aux autres bannières
  const nbAlertes = useMemo(
    () => alertes(comparaison, (cup) => refs.get(cupNormalise(cup))?.prix, reglages.seuil).filter((a) => a.obs.visite_id === visiteId).length,
    [comparaison, refs, reglages.seuil, visiteId],
  );

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
          setSecours(json.secours === true ? { lecteur: json.lecteur === "gemini" ? "gemini" : "claude", panne: typeof json.panne === "string" ? json.panne : "" } : null);
          // Retour immédiat : vignette de la photo avec le prix lu, et vibration si l'appareil le permet
          const lu = (json.scans as Scan[])[0];
          const n = json.scans.length;
          setVignette({ image: p.image, texte: n > 1 ? `${n} prix lus` : lu.produit || "Produit non lu", prix: (n > 1 ? "" : argent(promoUnitaire(lu) ?? lu.prix_regulier)) + (json.lecteur === "gemini" ? (n > 1 ? "Lu par Google" : " · lu par Google") : "") });
          setTimeout(() => setVignette((v) => (v?.image === p.image ? null : v)), 2800);
          try { navigator.vibrate?.(40); } catch { /* vibration non offerte */ }
          // Photo en haute résolution, gardée pour le zoom
          const chemin = (json.scans as Scan[])[0]?.photo_path;
          if (p.originale && chemin) sb.functions.invoke("photo", { body: { path: chemin, originale: p.originale, signee: p.signee === true } }).catch(() => {});
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
        const [{ image, originale: grande }, priseLe] = await Promise.all([reduire(fichier), datePhoto(fichier)]);
        // Signature au bas de la photo gardée (jamais sur l'image envoyée en lecture, ni sur une page de circulaire)
        const f = reglagesRef.current.filigrane;
        const signee = f.actif && mode === "carte"
          ? await filigraner(fichier, f, priseLe, [v.banniere, v.magasin].filter(Boolean).join(" · ")).catch(() => null)
          : null;
        const p: PhotoEnAttente = { id: crypto.randomUUID(), visiteId: v.id, image, originale: signee ?? grande, signee: Boolean(signee), priseLe, mode };
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

  async function rapport(v: Visite) {
    setRapportEnCours(true);
    setErreur("");
    try {
      const res = await fetch(`/api/rapport?visite=${v.id}`, { headers: { "x-jeton": lireJeton() ?? "" } });
      if (res.status === 401) return refuse();
      if (!res.ok) throw new Error((await res.json()).error || "Rapport impossible");
      const blob = await res.blob();
      const nom = `rapport-${v.banniere.toLowerCase().replace(/\s+/g, "-")}-${v.date_visite}.pdf`;
      const fichier = new File([blob], nom, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [fichier] })) await navigator.share({ files: [fichier] }).catch(() => {});
      else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = nom;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setRapportEnCours(false);
    }
  }

  // Suppression annulable : l'élément est dans la corbeille, on propose de le récupérer pendant quelques secondes.
  const proposerAnnulation = useCallback((objetId: string, texte: string) => {
    setAnnulable({ objetId, texte });
    setTimeout(() => setAnnulable((a) => (a?.objetId === objetId ? null : a)), 8000);
  }, []);

  async function annulerSuppression() {
    const a = annulable;
    if (!a) return;
    setAnnulable(null);
    const { data: ligne } = await sb.from("corbeille").select("id").eq("objet_id", a.objetId).order("supprime_le", { ascending: false }).limit(1).maybeSingle();
    const { data, error } = ligne ? await sb.rpc("restaurer", { corbeille_id: ligne.id }) : { data: null, error: null };
    if (error || !data?.ok) return setErreur("Récupération impossible. Regarde dans la corbeille (Réglages).");
    apresRestauration();
  }

  async function apresRestauration() {
    const l = await chargerVisites();
    if (!visiteRef.current && l.length) setVisite(l[0]);
    setNouvelle(false);
    chargerScans();
    setTout(null);
    setVersion((n) => n + 1);
  }

  // Recherche : les produits des autres visites sont chargés à la première recherche
  const cherche = recherche.trim().length >= 2;
  useEffect(() => {
    if (!cherche || tout) return;
    let annule = false;
    chargerTout(sb).then((t) => { if (!annule) setTout(t); }).catch(() => {});
    return () => { annule = true; };
  }, [sb, cherche, tout]);
  useEffect(() => { setTout(null); }, [visiteId, version]);

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

  // Gestes sur une ligne : glisser à gauche pour supprimer (récupérable), à droite pour marquer vérifié
  // Suppression d'une visite (glissement ou poubelle) : elle part à la corbeille avec ses prix, et peut être annulée.
  function apresSuppressionVisite(id: string) {
    const reste = visites.filter((x) => x.id !== id);
    setVisites(reste);
    if (visite?.id === id) {
      setVisite(reste[0] ?? null);
      if (!reste.length) setNouvelle(true);
    }
    setVersion((n) => n + 1);
    proposerAnnulation(id, "Visite supprimée.");
  }
  async function supprimerVisite(v: Visite) {
    const { data, error } = await sb.from("visites").delete().eq("id", v.id).select("id");
    if (error || !data?.length) return setErreur(error?.message ?? "Suppression refusée.");
    apresSuppressionVisite(v.id);
  }
  async function supprimerScan(s: Scan) {
    const { data, error } = await sb.from("scans").delete().eq("id", s.id).select("id");
    if (error || !data?.length) return setErreur(error?.message ?? "Accès en lecture seule : suppression refusée.");
    setScans((l) => l.filter((x) => x.id !== s.id));
    proposerAnnulation(s.id, "Prix supprimé.");
  }
  async function marquerVerifie(s: Scan) {
    setScans((l) => l.map((x) => (x.id === s.id ? { ...x, confiance: "haute" } : x)));
    const { data, error } = await sb.from("scans").update({ confiance: "haute" }).eq("id", s.id).select("id");
    if (error || !data?.length) {
      setScans((l) => l.map((x) => (x.id === s.id ? s : x)));
      setErreur(error?.message ?? "Accès en lecture seule : modification refusée.");
    }
  }

  function ouvrirScanner() {
    if (!visiteRef.current) return setNouvelle(true);
    setOnglet("scan");
    setRafale(true);
  }

  const rafraichir = useCallback(async () => {
    await Promise.all([chargerVisites(), chargerScans(), chargerListe()]);
    setVersion((n) => n + 1);
    traiterFile();
  }, [chargerVisites, chargerScans, chargerListe, traiterFile]);

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
  const mots = normaliser(recherche).split(" ").filter(Boolean);
  const visibles = scans.filter((s) => {
    if (filtre === "promos" && s.prix_promo === null) return false;
    if (filtre === "verifier" && (!s.confiance || s.confiance === "haute")) return false;
    if (filtre === "doublons" && !enDouble.has(s.id)) return false;
    if (!mots.length) return true;
    const texte = normaliser([s.produit, s.marque, s.format, s.cup, s.code_article, s.categorie].filter(Boolean).join(" "));
    return mots.every((m) => texte.includes(m));
  });
  // Mêmes mots cherchés dans les autres visites : un résultat par produit
  const ailleurs = useMemo(() => {
    if (!cherche || !tout || !mots.length) return [];
    return grouper(tout)
      .filter((g) => !g.observations.some((o) => o.visite_id === visiteId))
      .filter((g) => {
        const texte = normaliser([g.nom, g.marque, g.format, g.cup, g.categorie].filter(Boolean).join(" "));
        return mots.every((m) => texte.includes(m));
      })
      .slice(0, 15);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cherche, tout, recherche, visiteId]);
  // Prix regroupés par catégorie, dans l'ordre alphabétique ; les prix sans catégorie à la fin
  const sections = useMemo(() => {
    const m = new Map<string, Scan[]>();
    for (const s of visibles) {
      const c = s.categorie || "Sans catégorie";
      m.set(c, [...(m.get(c) ?? []), s]);
    }
    return [...m.entries()].sort((a, b) => (a[0] === "Sans catégorie" ? 1 : b[0] === "Sans catégorie" ? -1 : a[0].localeCompare(b[0], "fr")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scans, filtre, recherche, enDouble]);

  const ligne = (s: Scan) => {
    const pu = promoUnitaire(s);
    const unite = prixParUnite(prixEffectif(s), s.format);
    const ref = refs.get(cupNormalise(s.cup));
    const ecartRef = ref && prixEffectif(s) !== null ? ((prixEffectif(s)! - ref.prix) / ref.prix) * 100 : null;
    const incertain = Boolean(s.confiance && s.confiance !== "haute");
    const enCirculaire = promosGardees.get(`${s.visite_id}|${clePromo(s)}`) ?? promosGardees.get(`|${clePromo(s)}`);
    const moinsCher = Boolean(enCirculaire?.some((p) => p.ecart !== null && p.ecart <= -reglages.seuil));
    return (
      <Glissable key={s.id}
        gauche={lecture ? undefined : { libelle: "Supprimer", action: () => supprimerScan(s) }}
        droite={lecture || !incertain ? undefined : { libelle: "Vérifié", action: () => marquerVerifie(s) }}>
        <div className="tx" role="button" onClick={() => setEdition(s)}>
          <IconeProduit icone={s.icone} categorie={s.categorie} />
          <div className="mid">
            <div className="t">{s.produit || "Produit non lu"}</div>
            <div className="s">{[s.marque, s.format].filter(Boolean).join(" · ") || "Aucun détail"}</div>
            <div className="s">{momentLisible(s.photo_prise_le ?? s.created_at)}</div>
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
            {incertain && <span className="pill verif">À vérifier</span>}{" "}
            {enDouble.has(s.id) && <span className="pill verif">Doublon</span>}
            {enCirculaire && (
              <div className="en-circulaire" aria-label={`En circulaire chez ${enCirculaire.map((p) => p.banniere).join(", ")}`}>
                {enCirculaire.slice(0, 4).map((p) => logoBanniere(p.banniere)
                  ? <img key={p.banniere} src={logoBanniere(p.banniere)!} alt="" />
                  : <i key={p.banniere}>{p.banniere}</i>)}
                <span className={moinsCher ? "hausse" : ""}>
                  en circulaire : {argent(enCirculaire[0].prix)}
                  {enCirculaire[0].ecart !== null ? ` (${pctLisible(enCirculaire[0].ecart)})` : ""}
                </span>
              </div>
            )}
          </div>
          <div className="r">
            <b>{argent(pu ?? s.prix_regulier)}</b>
            {pu !== null && s.prix_regulier !== null && <span className="old">{argent(s.prix_regulier)}</span>}
            {unite && <small>{texteUnite(unite)}</small>}
          </div>
        </div>
      </Glissable>
    );
  };
  // Pour le code principal : de quel téléphone vient une visite faite par un collègue.
  const auteur = (v: Visite) => {
    if (!v.espace || !acces?.proprietaire) return "";
    const e = acces.espaces?.find((x) => x.id === v.espace);
    return e ? `Collègue ${e.numero}` : "Collègue";
  };
  const titres: Record<Onglet, string> = { scan: "Scan Prix", liste: "Liste", comparer: "Analyse", plus: "Plus", assistant: "Assistant", visites: "Visites", reglages: "Réglages" };
  const sousPage = onglet === "assistant" || onglet === "visites" || onglet === "reglages"; // pages ouvertes depuis « Plus »
  const allerReglages = (section: Section | null) => { setOuvrirReglages(section); setOnglet("reglages"); };
  const aVerifier = scans.filter((s) => s.confiance && s.confiance !== "haute");
  const puce = (f: Filtre, libelle: string, n: number) => (
    <button className={filtre === f ? "on" : ""} onClick={() => setFiltre(f)}>{libelle} ({n})</button>
  );

  return (
    <div className="app">
      <header>
        <span className="row titre">
          {sousPage && <button className="small rond" aria-label="Retour à Plus" onClick={() => setOnglet("plus")}><IChevron /></button>}
          <h1>{titres[onglet]}</h1>
        </span>
        <span className="row">
          {!sousPage && onglet !== "plus" && visites.length > 0 && (
            <button className="puce-visite" aria-label="Changer de visite" onClick={() => setMenu("visite")}>
              {visite && <PastilleBanniere banniere={visite.banniere} doux />}
              <span>{visite ? visite.magasin || visite.banniere : "Visite"}</span>
              <IChevron />
            </button>
          )}
          {!sousPage && onglet !== "plus" && !lecture && <button className="small rond plus" aria-label="Nouvelle visite" onClick={() => setNouvelle(true)}><IPlus /></button>}
          {onglet === "visites" && !lecture && <button className="small" onClick={() => setNouvelle(true)}><IPlus /> Nouvelle</button>}
          {!sousPage && <button className="small rond" aria-label="Rechercher partout" onClick={() => setMenu("recherche")}><IRecherche /></button>}
          {(onglet === "scan" || onglet === "comparer") && (
            <button className="small rond" aria-label="Exporter" disabled={exportEnCours || rapportEnCours} onClick={() => setMenu("export")}><IExport /></button>
          )}
        </span>
      </header>

      {onglet === "scan" && (
        <Principal rafraichir={rafraichir}>
          {erreur && <div className="alert" onClick={() => setErreur("")}>{erreur}</div>}
          {lecture && <div className="alert info">Accès en lecture seule : tu peux consulter, comparer et exporter.</div>}

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
            {visite && !lecture && <button className="ghost icone" aria-label="Modifier la visite" onClick={() => setModifVisite(visite)}><ICrayon /></button>}
          </div>

          {visite && (
            <>
              <div className="stats quatre">
                <button className={`stat ${filtre === "tous" && !recherche ? "" : "choisi"}`} onClick={() => { setFiltre("tous"); setRecherche(""); }}>
                  <small>Prix</small><b>{scans.length}</b><em>{filtre === "tous" && !recherche ? `${nbPromos} promo${nbPromos > 1 ? "s" : ""}` : "Tout voir"}</em>
                </button>
                <button className={`stat ${nbVerif ? "action" : ""}`} disabled={!nbVerif} onClick={() => setRevision(true)}>
                  <small>À vérifier</small><b>{nbVerif}</b><em>{nbVerif ? "Réviser" : "Rien"}</em>
                </button>
                <button className={`stat ${nbAlertes ? "alerte" : ""}`} disabled={!nbAlertes} onClick={() => { setVueAnalyse("alertes"); setOnglet("comparer"); }}>
                  <small>Alertes</small><b>{nbAlertes}</b><em>{nbAlertes ? "Voir" : `Seuil ${String(reglages.seuil).replace(".", ",")} %`}</em>
                </button>
                <button className="stat" disabled={!nbVariations} onClick={() => { setVueAnalyse("variations"); setOnglet("comparer"); }}>
                  <small>Variations</small><b>{nbVariations}</b><em>{nbVariations ? "Voir" : "Aucune"}</em>
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
              {secours && (
                <div className="alert avis" onClick={() => setSecours(null)}>
                  <span>
                    {secours.lecteur === "gemini"
                      ? "Claude n'a pas pu lire la photo : Google a pris le relais. Vérifie les lectures de plus près."
                      : "Google n'a pas pu lire la photo : Claude a pris le relais (lecture payante)."}
                    {secours.panne ? ` (${secours.panne})` : ""}
                  </span>
                </div>
              )}
              {enCours > 0 && <div className="alert info">Lecture de {enCours} photo{enCours > 1 ? "s" : ""} en cours…</div>}

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
                  </div>
                </>
              )}

              <div className="card">
                <div className="row between">
                  <h2 style={{ margin: 0 }}>Prix relevés</h2>
                  {!lecture && <button className="small" onClick={() => setImporter(true)}><IPhotos /> Importer</button>}
                </div>
                {chargement && !scans.length && <Fantomes />}
                {!chargement && !scans.length && (
                  <div className="empty">
                    <IEtiquette />
                    <div>Aucun prix pour l'instant.</div>
                    <div className="muted">Photographie une carte de prix, ou importe des photos déjà prises.</div>
                    {!lecture && <button className="primary" style={{ marginTop: 12 }} onClick={ouvrirScanner}><ICamera /> Photographier</button>}
                  </div>
                )}
                {scans.length > 0 && !visibles.length && (
                  <div className="empty">
                    <div>Aucun prix ne correspond dans cette visite.</div>
                    <button style={{ marginTop: 12 }} onClick={() => { setFiltre("tous"); setRecherche(""); }}>Tout afficher</button>
                  </div>
                )}
                {sections.map(([nom, lignes]) => {
                  const replie = replies.has(nom);
                  return (
                    <div key={nom} className="section">
                      {sections.length > 1 && (
                        <button className="entete" aria-expanded={!replie} onClick={() => setReplies((r) => { const n = new Set(r); if (replie) n.delete(nom); else n.add(nom); return n; })}>
                          <IChevron /><span>{nom}</span><b>{lignes.length}</b>
                        </button>
                      )}
                      {!(replie && sections.length > 1) && lignes.map(ligne)}
                    </div>
                  );
                })}
                {!lecture && scans.length > 0 && <div className="astuce">Glisse une ligne vers la gauche pour la supprimer{nbVerif ? ", vers la droite pour la marquer vérifiée" : ""}.</div>}
              </div>

              {ailleurs.length > 0 && (
                <div className="card">
                  <h2>Dans les autres visites</h2>
                  {ailleurs.map((g) => {
                    const dernier = g.observations[0];
                    const bannieres = [...new Set(g.observations.map((o) => o.visites?.banniere).filter(Boolean))];
                    return (
                      <div key={g.id} className="tx" role="button" onClick={() => setHistorique(g)}>
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
                </div>
              )}
            </>
          )}
        </Principal>
      )}

      {onglet === "liste" && <Liste liste={liste} scans={scans} visite={visite} recharger={chargerListe} listes={listes} listeId={listeId} choisir={setListeId} rechargerListes={chargerListes} lecture={lecture} codePostal={reglages.codePostal} refuse={refuse} />}

      {onglet === "comparer" && <Analyse key={`${vueAnalyse}-${version}`} historique={setHistorique} vueInitiale={vueAnalyse} visiteId={visite?.id ?? null} refuse={refuse}
        codePostal={reglages.codePostal} changerCodePostal={(c) => { enregistrerReglages({ ...reglagesRef.current, codePostal: c }).then((e) => e && setErreur(e)); }}
        seuil={reglages.seuil} changerSeuil={(s) => { enregistrerReglages({ ...reglagesRef.current, seuil: s }).then((e) => e && setErreur(e)); }} lecture={lecture} fige={!acces?.proprietaire} />}

      {onglet === "assistant" && <Assistant visite={visite} modifie={() => { chargerScans(); chargerListe(); }} refuse={refuse} />}

      {onglet === "visites" && (
        <Principal rafraichir={chargerVisites}>
          {erreur && <div className="alert" onClick={() => setErreur("")}>{erreur}</div>}
          <div className="card">
            <h2>Mes visites</h2>
            {!visites.length && (
              <div className="empty">
                <IMagasin /><div>Aucune visite.</div>
                {!lecture && <button className="primary" style={{ marginTop: 12 }} onClick={() => setNouvelle(true)}><IPlus /> Nouvelle visite</button>}
              </div>
            )}
            {visites.map((v) => (
              <Glissable key={v.id} gauche={lecture ? undefined : { libelle: "Supprimer", action: () => supprimerVisite(v) }}>
              <div className="tx" role="button" onClick={() => { setVisite(v); setOnglet("scan"); }}>
                <PastilleBanniere banniere={v.banniere} doux={v.id !== visite?.id} />
                <div className="mid">
                  <div className="t">{v.banniere}{v.magasin ? ` · ${v.magasin}` : ""}</div>
                  <div className="s">{dateLisible(v.date_visite)}{v.id === visite?.id ? " · en cours" : ""}{auteur(v) ? ` · ${auteur(v)}` : ""}</div>
                </div>
                {!lecture && <button className="ghost icone" aria-label={`Modifier la visite ${v.banniere}`} onClick={(e) => { e.stopPropagation(); setModifVisite(v); }}><ICrayon /></button>}
                {!lecture && <button className="ghost icone" aria-label={`Supprimer la visite ${v.banniere}`} onClick={(e) => { e.stopPropagation(); supprimerVisite(v); }}><IPoubelle /></button>}
                <button className="small" disabled={rapportEnCours} aria-label={`Rapport de la visite ${v.banniere}`} onClick={(e) => { e.stopPropagation(); rapport(v); }}>
                  PDF
                </button>
                <button className="small" disabled={exportEnCours} aria-label={`Excel de la visite ${v.banniere}`} onClick={(e) => { e.stopPropagation(); exporter(v); }}>
                  Excel
                </button>
              </div>
              </Glissable>
            ))}
          </div>
        </Principal>
      )}

      {onglet === "plus" && (
        <main>
          {erreur && <div className="alert" onClick={() => setErreur("")}>{erreur}</div>}
          <div className="card menu">
            {([
              { cle: "assistant", icone: <IAssistant />, titre: "Assistant", detail: "Pose une question sur tes prix ou fais ajouter un relevé", action: () => setOnglet("assistant") },
              { cle: "visites", icone: <IMagasin />, titre: "Visites", detail: `${visites.length} visite${visites.length > 1 ? "s" : ""}${visite ? ` · en cours : ${[visite.banniere, visite.magasin].filter(Boolean).join(" · ")}` : ""}`, action: () => setOnglet("visites") },
              { cle: "reglages", icone: <IReglages />, titre: "Réglages", detail: "Apparence, signature des photos, circulaires, accès collègue", action: () => allerReglages(null) },
              ...(acces?.proprietaire ? [{ cle: "partager", icone: <IPartage />, titre: "Partager l'application", detail: "Lien d'invitation pour un collègue : accès complet, espace privé", action: () => allerReglages("acces") }] : []),
              { cle: "corbeille", icone: <IEffacer />, titre: "Corbeille", detail: "Prix et visites supprimés, récupérables 30 jours", action: () => allerReglages("corbeille") },
              { cle: "export", icone: <IExport />, titre: "Exporter toutes les visites", detail: exportEnCours ? "Préparation du fichier…" : "Un fichier Excel avec tous tes relevés", action: () => !exportEnCours && exporter(null) },
            ]).map((l) => (
              <div key={l.cle} className="tx" role="button" onClick={l.action}>
                <div className="ic soft">{l.icone}</div>
                <div className="mid"><div className="t">{l.titre}</div><div className="s">{l.detail}</div></div>
                <span className="suite"><IChevron /></span>
              </div>
            ))}
          </div>
          <button className="full ghost" onClick={refuse}>Verrouiller l'app</button>
        </main>
      )}

      {onglet === "reglages" && (
        <Reglages
          key={ouvrirReglages ?? "menu"}
          reglages={reglages}
          enregistrer={enregistrerReglages}
          acces={acces}
          rechargerAcces={chargerAcces}
          visite={visite}
          sectionInitiale={ouvrirReglages}
          apparence={apparence}
          changerApparence={(a) => { setApparence(a); appliquerApparence(a); }}
          restaure={apresRestauration}
          verrouiller={refuse}
        />
      )}

      {menu === "visite" && (
        <ChoixVisite visites={visites} courante={visite} lecture={lecture} auteur={auteur} fermer={() => setMenu(null)}
          choisir={(v) => { setVisite(v); setMenu(null); }}
          nouvelle={() => { setMenu(null); setNouvelle(true); }}
          gerer={() => { setMenu(null); setOnglet("visites"); }}
          supprimer={supprimerVisite} />
      )}
      {menu === "export" && (
        <MenuExport visite={visite} vide={!scans.length} fermer={() => setMenu(null)}
          pdf={() => visite && rapport(visite)} excel={() => visite && exporter(visite)} tout={() => exporter(null)} />
      )}
      {menu === "recherche" && (
        <RechercheGlobale listes={listes} fermer={() => setMenu(null)}
          ouvrirProduit={(g) => { setMenu(null); setHistorique(g); }}
          ouvrirListe={(id) => { setMenu(null); setListeId(id); setOnglet("liste"); }} />
      )}

      {annulable && (
        <div className="annuler">
          <span>{annulable.texte}</span>
          <button onClick={annulerSuppression}>Annuler</button>
        </div>
      )}

      {vignette && (
        <div className="vignette" role="status">
          <img src={vignette.image} alt="" />
          <span><b>{vignette.texte}</b><small>{vignette.prix ? `Lu : ${vignette.prix}` : "Ajoutés à la visite"}</small></span>
        </div>
      )}

      <nav>
        <button className={onglet === "scan" ? "on" : ""} onClick={() => setOnglet("scan")}><IEtiquette />Prix</button>
        <button className={onglet === "liste" ? "on" : ""} onClick={() => setOnglet("liste")}><IListe />Liste</button>
        <button className="capture" aria-label="Photographier" disabled={lecture} onClick={ouvrirScanner}><span><ICamera /></span></button>
        <button className={onglet === "comparer" ? "on" : ""} onClick={() => { setVueAnalyse("accueil"); setVersion((n) => n + (onglet === "comparer" ? 1 : 0)); setOnglet("comparer"); }}><IComparer />Analyse</button>
        <button className={onglet === "plus" || sousPage ? "on" : ""} onClick={() => setOnglet("plus")}><IPlusMenu />Plus</button>
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
          supprimee={(id) => { setModifVisite(null); apresSuppressionVisite(id); }}
        />
      )}

      {edition && (
        <Edition
          scan={edition}
          fermer={() => setEdition(null)}
          enregistre={(s, garderOuvert) => { setScans((l) => l.map((x) => (x.id === s.id ? s : x))); if (!garderOuvert) setEdition(null); }}
          supprime={(id) => { setScans((l) => l.filter((x) => x.id !== id)); setEdition(null); proposerAnnulation(id, "Prix supprimé."); }}
          historique={ouvrirHistorique}
          lecture={lecture}
          codePostal={reglages.codePostal}
          banniere={visites.find((v) => v.id === edition.visite_id)?.banniere ?? null}
          seuil={reglages.seuil}
          promosChange={chargerPromos}
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

      {historique && <Historique groupe={historique} fermer={() => setHistorique(null)} lecture={lecture} modifie={() => { setVersion((n) => n + 1); chargerScans(); }} />}
    </div>
  );
}
