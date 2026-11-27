"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { cupNormalise, normaliser, prixEffectif, type Groupe } from "@/lib/comparaison";
import type { Reference } from "@/lib/types";
import { ecartPromo as ecart, emplacementOffre, imageOffre, lienSite, pctLisible as pct, type Offre } from "@/lib/promos";
import Visionneuse from "./Visionneuse";
import IconeProduit from "./IconeProduit";
import { Fantomes } from "./Gestes";
import { IRecherche, PastilleBanniere, argent, dateLisible } from "./ui";

type Resultat = { quand: number; juge: boolean; offres: Record<string, Offre[]> };

const MAX = 30;

/**
 * Promos en cours dans les circulaires des autres bannières, pour les produits relevés, avec l'écart par rapport
 * à mon prix. Suggestions tirées de Flipp (source non officielle) : à confirmer avant de s'en servir.
 */
export default function Promos({ enregistre, groupes, refs, visiteId, seuil, codePostal, changerCodePostal, lecture, fige, historique, refuse }: {
  enregistre?: () => void;
  groupes: Groupe[];
  refs: Map<string, Reference>;
  visiteId: string | null;
  seuil: number;
  codePostal: string;
  changerCodePostal: (c: string) => void;
  lecture: boolean;
  fige: boolean;
  historique: (g: Groupe) => void;
  refuse: () => void;
}) {
  const sb = supabaseBrowser();
  const [saisie, setSaisie] = useState(codePostal);
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState("");
  const [offreVue, setOffreVue] = useState<{ image: string; lien: { libelle: string; href: string } } | null>(null); // offre de circulaire ouverte en grand
  const [seulement, setSeulement] = useState(false); // seulement les écarts au-dessus du seuil
  const cle = `scanprix.promos.${visiteId ?? "tout"}`;

  // Produits visés : ceux de la visite en cours, sinon les plus récemment relevés. Mon prix : la référence, sinon le relevé.
  const produits = useMemo(() => {
    const liste = groupes
      .map((g) => {
        const obs = visiteId ? g.observations.find((o) => o.visite_id === visiteId) : g.observations[0];
        if (!obs) return null;
        const ref = refs.get(cupNormalise(g.cup));
        const prix = ref?.prix ?? prixEffectif(obs);
        return prix === null ? null : { groupe: g, prix, source: ref ? "Ma référence" : `Relevé ${obs.visites?.banniere ?? ""}`.trim(), banniere: obs.visites?.banniere ?? null, quand: obs.created_at };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .sort((a, b) => b.quand.localeCompare(a.quand));
    return liste;
  }, [groupes, refs, visiteId]);
  const vises = produits.slice(0, MAX);
  const banniereVisite = visiteId ? vises[0]?.banniere ?? null : null;

  useEffect(() => {
    try {
      const garde = JSON.parse(sessionStorage.getItem(cle) ?? "null") as Resultat | null;
      setResultat(garde && Date.now() - garde.quand < 6 * 3600 * 1000 ? garde : null);
    } catch { setResultat(null); }
  }, [cle]);

  const codeValide = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/.test(codePostal.trim());

  async function chercher() {
    setOccupe(true);
    setErreur("");
    try {
      const { data, error } = await sb.functions.invoke("promos", {
        body: {
          codePostal,
          exclure: banniereVisite ? [banniereVisite] : [],
          produits: vises.map((p) => ({ id: p.groupe.id, nom: p.groupe.nom, marque: p.groupe.marque, format: p.groupe.format })),
        },
      });
      if (error) throw new Error("Service de recherche indisponible. Vérifie ta connexion et réessaie.");
      if (data.acces === false) return refuse();
      if (data.error) throw new Error(data.error);
      const r: Resultat = { quand: Date.now(), juge: data.juge === true, offres: Object.fromEntries((data.resultats as { id: string; offres: Offre[] }[]).map((x) => [x.id, x.offres])) };
      setResultat(r);
      try { sessionStorage.setItem(cle, JSON.stringify(r)); } catch { /* stockage indisponible */ }
      // La dernière recherche est gardée : elle alimente les alertes, l'Excel et le rapport de visite.
      if (!lecture) {
        const lignes = vises.flatMap((p) => (r.offres[p.groupe.id] ?? []).map((o) => {
          const e = ecart(p.prix, p.groupe.format, o);
          return {
            visite_id: visiteId, produit: p.groupe.nom, marque: p.groupe.marque, format: p.groupe.format, cup: p.groupe.cup,
            mon_prix: p.prix, source_prix: p.source, banniere: o.banniere, offre: o.nom, prix: o.prix, prix_offre: o.prixOffre,
            quantite: o.quantite, format_offre: o.format, verdict: o.verdict, ecart_pct: e ? Math.round(e.pct * 10) / 10 : null,
            par_unite: e?.parUnite ?? null, fin: o.fin, lien: lienSite(o.banniere, { marque: p.groupe.marque, produit: p.groupe.nom }).href, emplacement: emplacementOffre(o),
          };
        }));
        const anciennes = sb.from("promos_circulaires").delete();
        const { error: e1 } = await (visiteId ? anciennes.eq("visite_id", visiteId) : anciennes.is("visite_id", null));
        const { error: e2 } = !e1 && lignes.length ? await sb.from("promos_circulaires").insert(lignes) : { error: null };
        if (e1 || e2) setErreur("Les promos sont affichées, mais n'ont pas pu être gardées pour les alertes et le rapport.");
        else enregistre?.();
      }
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setOccupe(false);
    }
  }

  const lignes = vises
    .map((p) => {
      const offres = (resultat?.offres[p.groupe.id] ?? [])
        .map((o) => ({ o, e: ecart(p.prix, p.groupe.format, o) }))
        .filter((x) => !seulement || (x.e !== null && x.e.pct <= -seuil))
        .sort((x, y) => (x.e?.pct ?? 999) - (y.e?.pct ?? 999));
      return { ...p, offres };
    })
    .filter((p) => p.offres.length)
    .sort((a, b) => (a.offres[0].e?.pct ?? 999) - (b.offres[0].e?.pct ?? 999));
  const nbOffres = resultat ? Object.values(resultat.offres).reduce((s, o) => s + o.length, 0) : 0;

  return (
    <>
      {offreVue && <Visionneuse src={offreVue.image} lien={offreVue.lien} fermer={() => setOffreVue(null)} />}
      <div className="card">
        <h2>Promos en cours chez les concurrents</h2>
        <div className="muted">
          Pour {visiteId ? "les produits de la visite en cours" : "tes produits les plus récents"} ({vises.length}{produits.length > MAX ? ` sur ${produits.length}` : ""}), l'app cherche les offres des circulaires
          {banniereVisite ? ` des autres bannières que ${banniereVisite}` : ""} et ne garde que les produits comparables.
        </div>
        <label>Code postal (région des circulaires)</label>
        <div className="row">
          <input className="grow" value={saisie} disabled={fige} onChange={(e) => setSaisie(e.target.value.toUpperCase())} placeholder="Ex. H2X 1Y4" maxLength={7} autoCapitalize="characters"
            onBlur={() => { if (saisie.trim() !== codePostal) changerCodePostal(saisie.trim()); }} />
        </div>
        <div className="actions">
          <button className="primary full" disabled={occupe || !codeValide || !vises.length} onClick={chercher}>
            <IRecherche /> {occupe ? "Recherche en cours…" : resultat ? "Chercher de nouveau" : "Chercher les promos"}
          </button>
        </div>
        {!codeValide && <div className="muted" style={{ marginTop: 8 }}>Entre ton code postal pour voir les circulaires de ta région.</div>}
        {!vises.length && <div className="muted" style={{ marginTop: 8 }}>Aucun produit avec un prix à comparer pour l'instant.</div>}
      </div>
      {erreur && <div className="alert" onClick={() => setErreur("")}>{erreur}</div>}
      {occupe && <div className="card"><Fantomes n={4} /></div>}

      {resultat && !occupe && (
        <>
          <div className="alert avis">
            <span>
              Suggestions tirées de Flipp (source non officielle), à confirmer dans la circulaire.
              {resultat.juge ? "" : " Claude n'a pas pu trier les offres : elles sont toutes à confirmer."}
            </span>
          </div>
          <div className="chips">
            <button className={!seulement ? "on" : ""} onClick={() => setSeulement(false)}>Toutes ({nbOffres})</button>
            <button className={seulement ? "on" : ""} onClick={() => setSeulement(true)}>Moins chères de {String(seuil).replace(".", ",")} % ou plus</button>
          </div>
          {!lignes.length && (
            <div className="card empty">
              <IRecherche />
              <div>{nbOffres ? "Aucune promo sous ton prix au-delà du seuil." : "Aucune promo comparable trouvée cette semaine."}</div>
              <div className="muted">Les circulaires changent chaque jeudi.</div>
            </div>
          )}
          {lignes.map((p) => (
            <div className="card" key={p.groupe.id}>
              <div className="tx" role="button" style={{ paddingTop: 0 }} onClick={() => historique(p.groupe)}>
                <IconeProduit icone={p.groupe.icone} categorie={p.groupe.categorie} />
                <div className="mid">
                  <div className="t">{p.groupe.nom}</div>
                  <div className="s">{[p.groupe.marque, p.groupe.format].filter(Boolean).join(" · ") || "Aucun détail"}</div>
                </div>
                <div className="r"><b>{argent(p.prix)}</b><small>{p.source}</small></div>
              </div>
              {p.offres.map(({ o, e }, i) => (
                <div key={i} className="tx" role="button" style={{ cursor: "pointer" }}
                  onClick={() => {
                    const site = lienSite(o.banniere, { marque: p.groupe.marque, produit: p.groupe.nom });
                    const img = imageOffre(o.image);
                    if (img) setOffreVue({ image: img, lien: site });
                    else window.open(site.href, "_blank", "noopener,noreferrer");
                  }}>
                  <PastilleBanniere banniere={o.banniere} doux />
                  <div className="mid">
                    <div className="t">{o.banniere}</div>
                    <div className="s">{o.nom}</div>
                    <div className="s">{[o.quantite > 1 ? `${o.quantite} pour ${argent(o.prixOffre)}` : null, o.fin ? `jusqu'au ${dateLisible(new Date(o.fin).toLocaleDateString("en-CA"))}` : null, e?.parUnite].filter(Boolean).join(" · ")}</div>
                    <span className={`pill ${o.verdict === "identique" ? "baisse" : "verif"}`}>
                      {o.verdict === "identique" ? "Identique" : o.verdict === "proche" ? (e ? "Proche · comparé par unité" : "Proche · format à confirmer") : "À confirmer"}
                    </span>
                    {emplacementOffre(o) && <> <span className={`pill ${o.page === 1 || o.page === o.pages ? "promo" : "membre"}`}>{emplacementOffre(o)}</span></>}
                  </div>
                  <div className="r">
                    <b>{argent(o.prix)}</b>
                    {e ? <span className={e.pct <= -seuil ? "hausse" : "muted"}>{pct(e.pct)}</span> : <small>sans écart</small>}
                  </div>
                </div>
              ))}
            </div>
          ))}
          <div className="astuce">Un écart négatif en rouge : le concurrent est moins cher que ton prix d'au moins {String(seuil).replace(".", ",")} %.</div>
        </>
      )}
    </>
  );
}
