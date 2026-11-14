"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { configOk, ecrireJeton, lireJeton, supabaseBrowser } from "@/lib/supabase";
import { correspond, doublons, grouper, normaliser, promoUnitaire, type Groupe } from "@/lib/comparaison";
import type { ProduitListe, Scan, Visite } from "@/lib/types";
import Assistant from "./composants/Assistant";
import Code from "./composants/Code";
import Comparer from "./composants/Comparer";
import Liste from "./composants/Liste";
import { Edition, Historique, NouvelleVisite } from "./composants/Fenetres";
import {
  IAssistant, ICamera, IComparer, IEtiquette, IExport, IListe, IMagasin, IPhotos, IPlus, IRecherche,
  argent, aujourdhui, chargerTout, dateLisible, reduire,
} from "./composants/ui";

type Onglet = "scan" | "liste" | "comparer" | "assistant" | "visites";
type Filtre = "tous" | "promos" | "verifier" | "doublons";

export default function Page() {
  const [acces, setAcces] = useState<"verification" | "code" | "ouvert">("verification");

  // À l'ouverture : le jeton gardé sur l'appareil est-il encore valide ?
  useEffect(() => {
    if (!configOk) return;
    if (!lireJeton()) return setAcces("code");
    supabaseBrowser().rpc("jeton_valide").then(({ data, error }) => {
      if (error) return setAcces("ouvert"); // hors ligne : on laisse entrer, les données resteront protégées par le serveur
      if (!data) ecrireJeton(null);
      setAcces(data ? "ouvert" : "code");
    });
  }, []);

  if (!configOk)
    return (
      <div className="app">
        <header><h1>Scan Prix</h1></header>
        <main><div className="alert">Configuration manquante : ajoute NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY (voir le README).</div></main>
      </div>
    );
  if (acces === "verification") return <div className="app" />;
  if (acces === "code") return <Code ouvert={() => setAcces("ouvert")} />;
  return <App refuse={() => { ecrireJeton(null); setAcces("code"); }} />;
}

function App({ refuse }: { refuse: () => void }) {
  const sb = supabaseBrowser();
  const [onglet, setOnglet] = useState<Onglet>("scan");
  const [visites, setVisites] = useState<Visite[]>([]);
  const [visite, setVisite] = useState<Visite | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [liste, setListe] = useState<ProduitListe[]>([]);
  const [enCours, setEnCours] = useState(0);
  const [erreur, setErreur] = useState("");
  const [edition, setEdition] = useState<Scan | null>(null);
  const [historique, setHistorique] = useState<Groupe | null>(null);
  const [nouvelle, setNouvelle] = useState(false);
  const [exportEnCours, setExportEnCours] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState<Filtre>("tous");
  const [categorie, setCategorie] = useState("");
  const [confirmerDoublons, setConfirmerDoublons] = useState(false);
  const visiteRef = useRef<Visite | null>(null);
  visiteRef.current = visite;

  // Visites : on reprend la plus récente à l'ouverture
  useEffect(() => {
    sb.from("visites").select("*").order("created_at", { ascending: false }).limit(200).then(({ data, error }) => {
      if (error) return setErreur(error.message);
      const l = (data ?? []) as Visite[];
      setVisites(l);
      if (l.length) setVisite(l[0]);
      else setNouvelle(true);
    });
  }, [sb]);

  const chargerScans = useCallback(async () => {
    const v = visiteRef.current;
    if (!v) return setScans([]);
    const { data, error } = await sb.from("scans").select("*").eq("visite_id", v.id).order("created_at", { ascending: false });
    if (error) setErreur(error.message);
    else if (visiteRef.current?.id === v.id) setScans((data ?? []) as Scan[]);
  }, [sb]);

  const chargerListe = useCallback(async () => {
    const { data, error } = await sb.from("liste_produits").select("*").order("created_at");
    if (error) setErreur(error.message);
    else setListe((data ?? []) as ProduitListe[]);
  }, [sb]);

  useEffect(() => { chargerScans(); }, [chargerScans, visite]);
  useEffect(() => { chargerListe(); }, [chargerListe]);

  // File d'attente : chaque photo est lue en arrière-plan, trois à la fois au maximum
  // (on peut enchaîner les cartes, ou importer d'un coup plusieurs photos déjà prises).
  const file = useRef<{ fichier: File; visiteId: string }[]>([]);
  const actifs = useRef(0);

  function avancer() {
    while (actifs.current < 3 && file.current.length) {
      const { fichier, visiteId } = file.current.shift()!;
      actifs.current++;
      (async () => {
        try {
          const image = await reduire(fichier);
          const { data: json, error } = await sb.functions.invoke("scan", { body: { image, visiteId } });
          if (error) throw new Error("Service de lecture indisponible. Réessaie dans un instant.");
          if (json.acces === false) return refuse();
          if (json.error) throw new Error(json.error);
          if (!json.scans.length) setErreur(json.message || "Aucune carte de prix lisible.");
          else if (visiteRef.current?.id === visiteId) setScans((s) => [...json.scans, ...s]);
        } catch (e) {
          setErreur(e instanceof Error ? e.message : "Erreur inconnue");
        } finally {
          actifs.current--;
          setEnCours((n) => n - 1);
          avancer();
        }
      })();
    }
  }

  function photographier(files: FileList | null) {
    const v = visiteRef.current;
    if (!files?.length || !v) return;
    setErreur("");
    const ajouts = Array.from(files).map((fichier) => ({ fichier, visiteId: v.id }));
    file.current.push(...ajouts);
    setEnCours((n) => n + ajouts.length);
    avancer();
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
  const titres: Record<Onglet, string> = { scan: "Scan Prix", liste: "Liste", comparer: "Comparer", assistant: "Assistant", visites: "Visites" };
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
            <div className="ic soft"><IMagasin /></div>
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
            <button className="ghost" onClick={() => setNouvelle(true)}>Nouvelle</button>
          </div>

          {visite && (
            <>
              <div className="stats">
                <div className="stat"><small>Prix</small><b>{scans.length}</b></div>
                <div className="stat"><small>Promos</small><b>{nbPromos}</b></div>
                <div className="stat"><small>À vérifier</small><b>{nbVerif}</b></div>
              </div>

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
                  return (
                    <div key={s.id} className="tx" role="button" onClick={() => setEdition(s)}>
                      <div className="ic">{(s.produit || "?").trim().charAt(0).toUpperCase()}</div>
                      <div className="mid">
                        <div className="t">{s.produit || "Produit non lu"}</div>
                        <div className="s">{[s.marque, s.format, s.categorie].filter(Boolean).join(" · ") || "Aucun détail"}</div>
                        {s.prix_promo !== null && (
                          <span className="pill promo">
                            {s.promo_quantite && s.promo_quantite > 1 ? `${s.promo_quantite} pour ${argent(s.prix_promo)}` : "Promo"}
                            {s.date_fin ? ` · jusqu'au ${dateLisible(s.date_fin)}` : ""}
                          </span>
                        )}{" "}
                        {s.confiance && s.confiance !== "haute" && <span className="pill verif">À vérifier</span>}{" "}
                        {enDouble.has(s.id) && <span className="pill verif">Doublon</span>}
                      </div>
                      <div className="r">
                        <b>{argent(pu ?? s.prix_regulier)}</b>
                        {pu !== null && s.prix_regulier !== null && <span className="old">{argent(s.prix_regulier)}</span>}
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

      {onglet === "comparer" && <Comparer historique={setHistorique} />}

      {onglet === "assistant" && <Assistant visite={visite} modifie={() => { chargerScans(); chargerListe(); }} refuse={refuse} />}

      {onglet === "visites" && (
        <main>
          {erreur && <div className="alert" onClick={() => setErreur("")}>{erreur}</div>}
          <div className="card">
            <h2>Mes visites</h2>
            {!visites.length && <div className="empty"><IMagasin /><div>Aucune visite.</div></div>}
            {visites.map((v) => (
              <div key={v.id} className="tx" role="button" onClick={() => { setVisite(v); setOnglet("scan"); }}>
                <div className={`ic ${v.id === visite?.id ? "" : "soft"}`}>{v.banniere.charAt(0).toUpperCase()}</div>
                <div className="mid">
                  <div className="t">{v.banniere}{v.magasin ? ` · ${v.magasin}` : ""}</div>
                  <div className="s">{dateLisible(v.date_visite)}{v.id === visite?.id ? " · en cours" : ""}</div>
                </div>
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
            <label className="principal">
              <ICamera /> Photographier
              <input type="file" accept="image/*" capture="environment" onChange={(e) => { photographier(e.target.files); e.target.value = ""; }} />
            </label>
            <label className="secondaire" aria-label="Importer des photos déjà prises">
              <IPhotos /> Importer
              <input type="file" accept="image/*" multiple onChange={(e) => { photographier(e.target.files); e.target.value = ""; }} />
            </label>
          </div>
        </div>
      )}

      <nav>
        <button className={onglet === "scan" ? "on" : ""} onClick={() => setOnglet("scan")}><IEtiquette />Prix</button>
        <button className={onglet === "liste" ? "on" : ""} onClick={() => setOnglet("liste")}><IListe />Liste</button>
        <button className={onglet === "comparer" ? "on" : ""} onClick={() => setOnglet("comparer")}><IComparer />Comparer</button>
        <button className={onglet === "assistant" ? "on" : ""} onClick={() => setOnglet("assistant")}><IAssistant />Assistant</button>
        <button className={onglet === "visites" ? "on" : ""} onClick={() => setOnglet("visites")}><IMagasin />Visites</button>
      </nav>

      {nouvelle && (
        <NouvelleVisite
          fermer={visites.length ? () => setNouvelle(false) : undefined}
          creee={(v) => { setVisites((l) => [v, ...l]); setVisite(v); setNouvelle(false); setOnglet("scan"); }}
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

      {historique && <Historique groupe={historique} fermer={() => setHistorique(null)} />}
    </div>
  );
}
