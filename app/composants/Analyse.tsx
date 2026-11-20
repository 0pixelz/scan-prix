"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { lireJeton, supabaseBrowser } from "@/lib/supabase";
import { alertes, comparer, cupNormalise, grouper, indices, normaliser, prixEffectif, statsBannieres, variations, type Groupe } from "@/lib/comparaison";
import { prixParUnite, texteUnite } from "@/lib/unite";
import type { Reference, ScanAvecVisite } from "@/lib/types";
import IconeProduit from "./IconeProduit";
import { Fantomes } from "./Gestes";
import Promos from "./Promos";
import { IComparer, IRecherche, PastilleBanniere, argent, chargerReferences, chargerTout, dateLisible } from "./ui";

export type VueAnalyse = "comparer" | "tableau" | "variations" | "alertes" | "promos" | "reference";

const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toLocaleString("fr-CA", { maximumFractionDigits: 1 })} %`;

/** Onglet Analyse : comparaison entre bannières, tableau de bord, variations de prix et prix de référence. */
export default function Analyse({ historique, vueInitiale, visiteId, refuse, seuil, changerSeuil, lecture, codePostal, changerCodePostal }: {
  codePostal: string;
  changerCodePostal: (c: string) => void;
  seuil: number;
  changerSeuil: (s: number) => void;
  lecture: boolean;
  historique: (g: Groupe) => void;
  vueInitiale: VueAnalyse;
  visiteId: string | null;
  refuse: () => void;
}) {
  const sb = supabaseBrowser();
  const [vue, setVue] = useState<VueAnalyse>(vueInitiale);
  const [scans, setScans] = useState<ScanAvecVisite[] | null>(null);
  const [refs, setRefs] = useState<Map<string, Reference>>(new Map());
  const [nbRefs, setNbRefs] = useState<number | null>(null);
  const [erreur, setErreur] = useState("");
  const [recherche, setRecherche] = useState("");
  const [tous, setTous] = useState(false);
  const [cetteVisite, setCetteVisite] = useState((vueInitiale === "variations" || vueInitiale === "alertes") && Boolean(visiteId));
  const [message, setMessage] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [confirmerVider, setConfirmerVider] = useState(false);

  const compterRefs = useCallback(async () => {
    const { count } = await sb.from("reference_prix").select("cup", { count: "exact", head: true });
    setNbRefs(count ?? 0);
  }, [sb]);

  const charger = useCallback(async () => {
    try {
      const tout = await chargerTout(sb);
      setScans(tout);
      setRefs(await chargerReferences(sb, tout.map((s) => s.cup)));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur inconnue");
    }
  }, [sb]);

  useEffect(() => { charger(); compterRefs(); }, [charger, compterRefs]);

  const groupes = useMemo(() => grouper(scans ?? []), [scans]);
  const lignes = useMemo(() => comparer(groupes), [groupes]);
  const changements = useMemo(() => variations(groupes), [groupes]);
  const mots = normaliser(recherche).split(" ").filter(Boolean);
  const correspond = (g: Groupe) => {
    if (!mots.length) return true;
    const texte = normaliser([g.nom, g.marque, g.format, g.cup, g.categorie].filter(Boolean).join(" "));
    return mots.every((m) => texte.includes(m));
  };
  const reference = (g: Groupe) => refs.get(cupNormalise(g.cup));
  const [seuilTexte, setSeuilTexte] = useState(String(seuil).replace(".", ","));
  const depassements = useMemo(() => alertes(lignes, (cup) => refs.get(cupNormalise(cup))?.prix, seuil), [lignes, refs, seuil]);

  async function importer(fichiers: FileList | null) {
    if (!fichiers?.length) return;
    setEnvoi(true);
    setMessage("");
    setErreur("");
    try {
      const corps = new FormData();
      corps.append("fichier", fichiers[0]);
      const rep = await fetch("/api/reference", { method: "POST", headers: { "x-jeton": lireJeton() ?? "" }, body: corps });
      if (rep.status === 401) return refuse();
      const json = await rep.json();
      if (!rep.ok) throw new Error(json.error || "Import impossible");
      setMessage(`${json.importes.toLocaleString("fr-CA")} prix importés${json.ignorees ? `, ${json.ignorees.toLocaleString("fr-CA")} lignes ignorées (CUP ou prix manquant)` : ""}.`);
      await Promise.all([compterRefs(), charger()]);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setEnvoi(false);
    }
  }

  async function vider() {
    const { error } = await sb.from("reference_prix").delete().neq("cup", "");
    if (error) return setErreur(error.message);
    setConfirmerVider(false);
    setMessage("Liste de référence vidée.");
    setRefs(new Map());
    compterRefs();
  }

  const puce = (v: VueAnalyse, libelle: string) => <button className={vue === v ? "on" : ""} onClick={() => setVue(v)}>{libelle}</button>;
  const chargement = scans === null && !erreur;

  return (
    <main>
      {erreur && <div className="alert" onClick={() => setErreur("")}>{erreur}</div>}
      <div className="chips">
        {puce("comparer", "Comparer")}
        {puce("tableau", "Tableau de bord")}
        {puce("variations", `Variations${changements.length ? ` (${changements.length})` : ""}`)}
        {puce("alertes", `Alertes${depassements.length ? ` (${depassements.length})` : ""}`)}
        {puce("promos", "Circulaires")}
        {puce("reference", "Référence")}
      </div>

      {(vue === "comparer" || vue === "variations" || vue === "alertes") && (
        <div className="search">
          <IRecherche />
          <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Chercher un produit" />
        </div>
      )}
      {chargement && <div className="card"><Fantomes n={5} /></div>}

      {/* ---------- Comparer ---------- */}
      {vue === "comparer" && scans !== null && (() => {
        const visibles = lignes.filter((l) => (tous || l.parBanniere.length > 1) && correspond(l.groupe));
        const nbCompares = lignes.filter((l) => l.parBanniere.length > 1).length;
        return (
          <>
            <div className="chips">
              <button className={!tous ? "on" : ""} onClick={() => setTous(false)}>Dans 2 bannières ou plus ({nbCompares})</button>
              <button className={tous ? "on" : ""} onClick={() => setTous(true)}>Tous les produits ({lignes.length})</button>
            </div>
            {!visibles.length && (
              <div className="card empty">
                <IComparer />
                <div>{recherche ? "Aucun produit trouvé." : "Rien à comparer pour l'instant."}</div>
                {!recherche && <div className="muted">Relève le même produit dans deux bannières différentes pour voir l'écart de prix.</div>}
              </div>
            )}
            {visibles.map((l) => {
              const ref = reference(l.groupe);
              return (
                <div key={l.groupe.id} className="card cmp" role="button" onClick={() => historique(l.groupe)}>
                  <div className="row between" style={{ gap: 12 }}>
                    <IconeProduit icone={l.groupe.icone} categorie={l.groupe.categorie} />
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
                    {l.parBanniere.map((b, i) => {
                      const pu = prixParUnite(b.prix, b.obs.format);
                      return (
                        <div key={b.banniere} className={i === 0 && l.parBanniere.length > 1 ? "moins" : ""}>
                          <span>{b.banniere}</span>
                          <b>{argent(b.prix)}</b>
                          {pu && <small>{texteUnite(pu)}</small>}
                          <small>{b.obs.prix_membre ? "Membre · " : b.obs.prix_promo !== null ? "Promo · " : ""}{b.obs.visites ? dateLisible(b.obs.visites.date_visite) : ""}</small>
                          {ref && <small className={b.prix < ref.prix ? "baisse" : b.prix > ref.prix ? "hausse" : ""}>{pct(((b.prix - ref.prix) / ref.prix) * 100)} vs réf.</small>}
                        </div>
                      );
                    })}
                    {ref && (
                      <div className="ref">
                        <span>Ma référence</span>
                        <b>{argent(ref.prix)}</b>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        );
      })()}

      {/* ---------- Tableau de bord ---------- */}
      {vue === "tableau" && scans !== null && (() => {
        const idx = indices(lignes);
        const stats = statsBannieres(scans);
        const maxIndice = Math.max(100, ...idx.map((i) => i.indice));
        // Écart moyen de chaque bannière par rapport à la référence, sur les produits qui ont un prix de référence
        const ecartsRef = stats
          .map((s) => {
            const ecarts = lignes.flatMap((l) => {
              const ref = reference(l.groupe);
              const b = l.parBanniere.find((x) => normaliser(x.banniere) === normaliser(s.banniere));
              return ref && b ? [((b.prix - ref.prix) / ref.prix) * 100] : [];
            });
            return { banniere: s.banniere, n: ecarts.length, moyenne: ecarts.length ? ecarts.reduce((a, b) => a + b, 0) / ecarts.length : 0 };
          })
          .filter((e) => e.n > 0);
        return (
          <>
            {!scans.length && <div className="card empty"><IComparer /><div>Aucune donnée pour l'instant.</div></div>}
            {scans.length > 0 && (
              <div className="card">
                <h2>Indice de prix par bannière</h2>
                {idx.length < 2 ? (
                  <div className="muted">Relève les mêmes produits dans au moins deux bannières pour obtenir un indice.</div>
                ) : (
                  <>
                    {idx.map((i, rang) => (
                      <div key={i.banniere} className="indice">
                        <PastilleBanniere banniere={i.banniere} doux />
                        <div className="grow">
                          <div className="row between">
                            <b>{i.banniere}</b>
                            <b className={rang === 0 ? "baisse" : ""}>{i.indice.toFixed(1).replace(".", ",")}</b>
                          </div>
                          <div className="bar"><i style={{ width: `${(i.indice / maxIndice) * 100}%` }} /></div>
                          <div className="muted">{i.produits} produit{i.produits > 1 ? "s" : ""} en commun</div>
                        </div>
                      </div>
                    ))}
                    <div className="muted" style={{ marginTop: 8 }}>100 = moyenne des bannières sur les produits communs. Plus bas = moins cher.</div>
                  </>
                )}
              </div>
            )}
            {stats.length > 0 && (
              <div className="card">
                <h2>Relevés par bannière</h2>
                <div className="tableau">
                  <div className="entete"><span>Bannière</span><span>Visites</span><span>Prix</span><span>Promos</span><span>Membre</span></div>
                  {stats.map((s) => (
                    <div key={s.banniere}>
                      <span>{s.banniere}</span>
                      <span>{s.visites}</span>
                      <span>{s.prix}</span>
                      <span>{s.prix ? Math.round((s.promos / s.prix) * 100) : 0} %</span>
                      <span>{s.membres}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {ecartsRef.length > 0 && (
              <div className="card">
                <h2>Écart moyen par rapport à ma référence</h2>
                {ecartsRef.map((e) => (
                  <div key={e.banniere} className="tx" style={{ cursor: "default" }}>
                    <PastilleBanniere banniere={e.banniere} doux />
                    <div className="mid">
                      <div className="t">{e.banniere}</div>
                      <div className="s">{e.n} produit{e.n > 1 ? "s" : ""} avec un prix de référence</div>
                    </div>
                    <div className="r"><b className={e.moyenne < 0 ? "baisse" : e.moyenne > 0 ? "hausse" : ""}>{pct(e.moyenne)}</b></div>
                  </div>
                ))}
                <div className="muted" style={{ marginTop: 8 }}>Négatif = la bannière est moins chère que ma référence.</div>
              </div>
            )}
          </>
        );
      })()}

      {/* ---------- Variations ---------- */}
      {vue === "variations" && scans !== null && (() => {
        const visibles = changements.filter((c) => correspond(c.groupe) && (!cetteVisite || c.apres.visite_id === visiteId));
        return (
          <>
            {visiteId && (
              <div className="chips">
                <button className={!cetteVisite ? "on" : ""} onClick={() => setCetteVisite(false)}>Toutes les bannières</button>
                <button className={cetteVisite ? "on" : ""} onClick={() => setCetteVisite(true)}>Visite en cours</button>
              </div>
            )}
            {!visibles.length && (
              <div className="card empty">
                <IComparer />
                <div>Aucun changement de prix.</div>
                <div className="muted">Les variations apparaissent quand un produit est relevé à deux visites différentes dans la même bannière.</div>
              </div>
            )}
            {visibles.length > 0 && (
              <div className="card">
                <h2>Hausses : {visibles.filter((c) => c.delta > 0).length} · Baisses : {visibles.filter((c) => c.delta < 0).length}</h2>
                {visibles.map((c) => (
                  <div key={`${c.groupe.id}-${c.banniere}`} className="tx" role="button" onClick={() => historique(c.groupe)}>
                    <IconeProduit icone={c.groupe.icone} categorie={c.groupe.categorie} />
                    <div className="mid">
                      <div className="t">{c.groupe.nom}</div>
                      <div className="s">{[c.banniere, c.groupe.format].filter(Boolean).join(" · ")}</div>
                      <div className="s">
                        {argent(prixEffectif(c.avant))} le {c.avant.visites ? dateLisible(c.avant.visites.date_visite) : "?"} → {argent(prixEffectif(c.apres))} le {c.apres.visites ? dateLisible(c.apres.visites.date_visite) : "?"}
                      </div>
                    </div>
                    <div className="r">
                      <b className={c.delta > 0 ? "hausse" : "baisse"}>{c.delta > 0 ? "+" : "−"}{argent(Math.abs(c.delta))}</b>
                      <span className="muted">{pct(c.pct)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        );
      })()}

      {/* ---------- Alertes ---------- */}
      {vue === "alertes" && scans !== null && (() => {
        const visibles = depassements.filter((a) => correspond(a.groupe) && (!cetteVisite || a.obs.visite_id === visiteId));
        const vsRef = visibles.filter((a) => a.type === "reference");
        const entre = visibles.filter((a) => a.type === "bannieres");
        const enregistrerSeuil = () => {
          const v = parseFloat(seuilTexte.replace(",", "."));
          if (Number.isFinite(v) && v > 0 && v !== seuil) changerSeuil(Math.round(v * 10) / 10);
          else setSeuilTexte(String(seuil).replace(".", ","));
        };
        return (
          <>
            <div className="card seuil">
              <div className="grow">
                <b>Seuil d'alerte</b>
                <div className="muted">Un écart de prix égal ou supérieur à ce pourcentage est signalé.</div>
              </div>
              <input value={seuilTexte} inputMode="decimal" disabled={lecture} aria-label="Seuil d'alerte en pourcentage"
                onChange={(e) => setSeuilTexte(e.target.value)} onBlur={enregistrerSeuil} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
              <span>%</span>
            </div>
            {visiteId && (
              <div className="chips">
                <button className={!cetteVisite ? "on" : ""} onClick={() => setCetteVisite(false)}>Toutes les visites</button>
                <button className={cetteVisite ? "on" : ""} onClick={() => setCetteVisite(true)}>Visite en cours</button>
              </div>
            )}
            {!visibles.length && (
              <div className="card empty">
                <IComparer />
                <div>Aucun écart au-dessus de {String(seuil).replace(".", ",")} %.</div>
                <div className="muted">Les alertes comparent chaque prix à ta liste de référence, et les bannières entre elles pour un même produit.</div>
              </div>
            )}
            {[{ titre: "Par rapport à ma référence", liste: vsRef }, { titre: "Entre bannières", liste: entre }].map(({ titre, liste }) => liste.length > 0 && (
              <div className="card" key={titre}>
                <h2>{titre} ({liste.length})</h2>
                {liste.map((a) => (
                  <div key={`${a.type}-${a.groupe.id}-${a.banniere}`} className="tx" role="button" onClick={() => historique(a.groupe)}>
                    <IconeProduit icone={a.groupe.icone} categorie={a.groupe.categorie} />
                    <div className="mid">
                      <div className="t">{a.groupe.nom}</div>
                      <div className="s">{[a.groupe.marque, a.groupe.format].filter(Boolean).join(" · ") || "Aucun détail"}</div>
                      <div className="s">{a.banniere} {argent(a.prix)} · {a.baseNom} {argent(a.base)}</div>
                    </div>
                    <div className="r">
                      <b className={a.pct > 0 ? "hausse" : "baisse"}>{pct(a.pct)}</b>
                      <span className="muted">{a.prix - a.base > 0 ? "+" : "−"}{argent(Math.abs(a.prix - a.base))}</span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </>
        );
      })()}

      {/* ---------- Promos des circulaires ---------- */}
      {vue === "promos" && scans !== null && (
        <Promos groupes={groupes} refs={refs} visiteId={visiteId} seuil={seuil} codePostal={codePostal} changerCodePostal={changerCodePostal} lecture={lecture} historique={historique} refuse={refuse} />
      )}

      {/* ---------- Référence ---------- */}
      {vue === "reference" && (
        <>
          <div className="card">
            <h2>Ma liste de prix de référence</h2>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{nbRefs === null ? "…" : nbRefs.toLocaleString("fr-CA")} <span className="muted">produit{nbRefs === 1 ? "" : "s"}</span></div>
            <p className="muted">
              Importe un fichier Excel (.xlsx) ou CSV avec une colonne <b>CUP</b> et une colonne <b>Prix</b> (une colonne Nom est facultative).
              Chaque relevé qui a le même CUP affiche alors son écart par rapport à ton prix. Un nouvel import met à jour les CUP déjà présents.
            </p>
            {message && <div className="alert info">{message}</div>}
            <div className="actions">
              {!lecture && <label className={`bouton primary full ${envoi ? "inactif" : ""}`}>
                {envoi ? "Import en cours…" : "Importer un fichier"}
                <input type="file" accept=".xlsx,.csv,.txt" disabled={envoi} onChange={(e) => { importer(e.target.files); e.target.value = ""; }} />
              </label>}
              {!lecture && nbRefs !== null && nbRefs > 0 && (
                <button className="danger full" onClick={confirmerVider ? vider : () => setConfirmerVider(true)}>
                  {confirmerVider ? "Confirmer : effacer toute la liste" : "Vider la liste"}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
