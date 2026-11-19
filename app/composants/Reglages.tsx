"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { lignesFiligrane } from "@/lib/filigrane";
import type { Acces, Reglages as TReglages, Visite } from "@/lib/types";
import { IEffacer, IEtiquette, IMagasin, IRestaurer, argent, dateLisible, momentLisible } from "./ui";

type Section = "filigrane" | "cout" | "acces" | "corbeille";
type Jete = { id: string; type: "visites" | "scans"; objet_id: string; donnees: Record<string, unknown>; lot: number; supprime_le: string };
type Usage = { quand: string; fonction: string; modele: string; entree: number; sortie: number; photos: number };

const nombre = (v: number) => v.toLocaleString("fr-CA");
const usd = (v: number) => `${v.toLocaleString("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $ US`;

/** Réglages : signature des photos, coût Claude, accès d'un collègue et corbeille. */
export default function Reglages({ reglages, enregistrer, acces, rechargerAcces, visite, fermer, restaure, verrouiller, sectionInitiale }: {
  reglages: TReglages;
  enregistrer: (r: TReglages) => Promise<string | null>;
  acces: Acces | null;
  rechargerAcces: () => void;
  visite: Visite | null;
  fermer: () => void;
  restaure: () => void;
  verrouiller: () => void;
  sectionInitiale?: Section;
}) {
  const sb = supabaseBrowser();
  const lecture = acces?.role === "lecture";
  const [section, setSection] = useState<Section>(sectionInitiale ?? "filigrane");
  const [f, setF] = useState(reglages.filigrane);
  const [tarifs, setTarifs] = useState(() => Object.fromEntries(Object.entries(reglages.tarifs).map(([k, v]) => [k, String(v).replace(".", ",")])) as Record<keyof TReglages["tarifs"], string>);
  const [message, setMessage] = useState("");
  const [erreur, setErreur] = useState("");

  const sauver = async (r: TReglages, texte: string) => {
    setErreur("");
    const e = await enregistrer(r);
    if (e) setErreur(e);
    else setMessage(texte);
  };
  useEffect(() => { setMessage(""); setErreur(""); }, [section]);

  // ---------- Coût ----------
  const [usage, setUsage] = useState<Usage[] | null>(null);
  useEffect(() => {
    if (section !== "cout" || usage) return;
    (async () => {
      const debut = new Date();
      debut.setMonth(debut.getMonth() - 1, 1);
      debut.setHours(0, 0, 0, 0);
      const tout: Usage[] = [];
      for (let i = 0; i < 20000; i += 1000) {
        const { data, error } = await sb.from("usage_claude").select("quand, fonction, modele, entree, sortie, photos").gte("quand", debut.toISOString()).order("quand").range(i, i + 999);
        if (error) return setErreur(error.message);
        tout.push(...((data ?? []) as Usage[]));
        if (!data || data.length < 1000) break;
      }
      setUsage(tout);
    })();
  }, [sb, section, usage]);

  const t = (k: keyof TReglages["tarifs"]) => {
    const v = parseFloat(tarifs[k].replace(",", "."));
    return Number.isFinite(v) && v >= 0 ? v : reglages.tarifs[k];
  };
  const cout = (u: Usage) => {
    const sonnet = !/haiku/i.test(u.modele);
    return (u.entree / 1e6) * t(sonnet ? "sonnetEntree" : "haikuEntree") + (u.sortie / 1e6) * t(sonnet ? "sonnetSortie" : "haikuSortie");
  };
  const mois = (decalage: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() - decalage, 1);
    const cle = `${d.getFullYear()}-${d.getMonth()}`;
    const lignes = (usage ?? []).filter((u) => { const q = new Date(u.quand); return `${q.getFullYear()}-${q.getMonth()}` === cle; });
    const lectures = lignes.filter((u) => u.fonction !== "assistant");
    const messages = lignes.filter((u) => u.fonction === "assistant");
    return {
      nom: d.toLocaleDateString("fr-CA", { month: "long", year: "numeric" }),
      photos: lectures.reduce((s, u) => s + (u.photos || 0), 0),
      messages: messages.length,
      coutPhotos: lectures.reduce((s, u) => s + cout(u), 0),
      coutMessages: messages.reduce((s, u) => s + cout(u), 0),
      jetons: lignes.reduce((s, u) => s + u.entree + u.sortie, 0),
    };
  };

  // ---------- Accès collègue ----------
  const [code, setCode] = useState("");
  const [role, setRole] = useState<"lecture" | "complet">("lecture");
  const [retirer, setRetirer] = useState(false);
  async function definirCode(e: React.FormEvent) {
    e.preventDefault();
    setErreur("");
    setMessage("");
    const { data, error } = await sb.rpc("definir_code_collegue", { code, role });
    if (error) return setErreur(error.message);
    if (!data?.ok) {
      const textes: Record<string, string> = { acces: "Seul le code principal peut gérer l'accès du collègue.", format: "Le code doit avoir 4 chiffres.", identique: "Ce code est déjà ton code principal : choisis-en un autre.", role: "Type d'accès invalide." };
      return setErreur(textes[data?.erreur] ?? "Code refusé.");
    }
    setCode("");
    setMessage("Code du collègue enregistré. Donne-lui ce code de vive voix : il n'est affiché nulle part.");
    rechargerAcces();
  }
  async function retirerCode() {
    const { data, error } = await sb.rpc("retirer_code_collegue");
    if (error || !data?.ok) return setErreur(error?.message ?? "Retrait refusé.");
    setRetirer(false);
    setMessage("Accès du collègue retiré. Ses appareils sont déconnectés.");
    rechargerAcces();
  }

  // ---------- Corbeille ----------
  const [jetes, setJetes] = useState<Jete[] | null>(null);
  const [vider, setVider] = useState(false);
  const chargerCorbeille = useCallback(async () => {
    await sb.rpc("purger_corbeille");
    const { data, error } = await sb.from("corbeille").select("*").order("supprime_le", { ascending: false }).limit(1000);
    if (error) return setErreur(error.message);
    setJetes((data ?? []) as Jete[]);
  }, [sb]);
  useEffect(() => { if (section === "corbeille") chargerCorbeille(); }, [section, chargerCorbeille]);

  async function restaurer(j: Jete) {
    setErreur("");
    setMessage("");
    const { data, error } = await sb.rpc("restaurer", { corbeille_id: j.id });
    if (error) return setErreur(error.message);
    if (!data?.ok) {
      const textes: Record<string, string> = { acces: "Accès en lecture seule : récupération refusée.", visite: "La visite de ce prix est aussi dans la corbeille : récupère d'abord la visite.", introuvable: "Cet élément n'est plus dans la corbeille." };
      setErreur(textes[data?.erreur] ?? "Récupération impossible.");
    } else {
      setMessage(j.type === "visites" ? `Visite récupérée avec ${data.prix} prix.` : "Prix récupéré.");
      restaure();
    }
    chargerCorbeille();
  }
  async function viderCorbeille() {
    const { data, error } = await sb.rpc("vider_corbeille");
    if (error || !data?.ok) return setErreur(error?.message ?? "Accès en lecture seule : action refusée.");
    setVider(false);
    setMessage("Corbeille vidée.");
    chargerCorbeille();
  }
  // Les prix supprimés en même temps que leur visite reviennent avec elle : on ne les liste pas un par un.
  const visitesJetees = (jetes ?? []).filter((j) => j.type === "visites");
  const avecVisite = (j: Jete) => visitesJetees.some((v) => v.lot === j.lot && v.objet_id === j.donnees.visite_id);
  const affiches = (jetes ?? []).filter((j) => j.type === "visites" || !avecVisite(j));

  const puce = (s: Section, libelle: string) => <button className={section === s ? "on" : ""} onClick={() => setSection(s)}>{libelle}</button>;
  const lieu = visite ? [visite.banniere, visite.magasin].filter(Boolean).join(" · ") : "Bannière · magasin de la visite";
  const apercu = lignesFiligrane(f, new Date().toISOString(), lieu);

  return (
    <div className="sheet" onClick={(e) => e.target === e.currentTarget && fermer()}>
      <div className="panel reglages">
        <div className="grip" />
        <div className="row between">
          <h3>Réglages</h3>
          <button type="button" className="ghost" onClick={fermer}>Fermer</button>
        </div>
        <div className="chips" style={{ marginTop: 10 }}>
          {puce("filigrane", "Signature des photos")}
          {puce("cout", "Coût Claude")}
          {puce("acces", "Accès collègue")}
          {puce("corbeille", "Corbeille")}
        </div>
        {message && <div className="alert info">{message}</div>}
        {erreur && <div className="alert" onClick={() => setErreur("")}>{erreur}</div>}

        {section === "filigrane" && (
          <form onSubmit={(e) => { e.preventDefault(); sauver({ ...reglages, filigrane: { ...f, nom: f.nom.trim(), poste: f.poste.trim() } }, "Signature enregistrée. Elle s'applique aux prochaines photos."); }}>
            <label className="case"><input type="checkbox" checked={f.actif} disabled={lecture} onChange={(e) => setF({ ...f, actif: e.target.checked })} />Ajouter une signature au bas des photos</label>
            {f.actif && (
              <>
                <label className="case"><input type="checkbox" checked={f.logo} disabled={lecture} onChange={(e) => setF({ ...f, logo: e.target.checked })} />Afficher le logo</label>
                <label>Nom</label>
                <input value={f.nom} disabled={lecture} onChange={(e) => setF({ ...f, nom: e.target.value })} placeholder="Ex. Jonathan Plouffe" maxLength={60} />
                <label>Poste ou équipe</label>
                <input value={f.poste} disabled={lecture} onChange={(e) => setF({ ...f, poste: e.target.value })} placeholder="Ex. Chef gestion des prix, Équipe pricing" maxLength={60} />
                <label className="case"><input type="checkbox" checked={f.lieu} disabled={lecture} onChange={(e) => setF({ ...f, lieu: e.target.checked })} />Ajouter le lieu (bannière et magasin de la visite)</label>
                <label>Transparence : {100 - f.opacite} %</label>
                <input type="range" className="curseur" min={0} max={80} step={5} value={100 - f.opacite} disabled={lecture} aria-label="Transparence de la signature"
                  onChange={(e) => setF({ ...f, opacite: 100 - Number(e.target.value) })} />
                <label>Aperçu</label>
                <div className="apercufili">
                  <div style={{ opacity: f.opacite / 100 }}>
                    {f.logo && <img src="/marque/metro.webp" alt="Logo" />}
                    {apercu.map((l, i) => <span key={i} className={i === 0 && f.nom.trim() ? "nom" : ""}>{l}</span>)}
                  </div>
                </div>
                <div className="muted">La date et l'heure sont celles de la photo. La signature est placée en bas à gauche de la photo gardée ; l'image lue par Claude reste sans signature.</div>
              </>
            )}
            {!lecture && <div className="actions"><button className="primary full">Enregistrer</button></div>}
          </form>
        )}

        {section === "cout" && (
          <>
            {usage === null && !erreur && <p className="muted">Chargement…</p>}
            {usage !== null && [0, 1].map((d) => {
              const m = mois(d);
              return (
                <div className="bloc" key={d}>
                  <div className="row between"><b style={{ textTransform: "capitalize" }}>{m.nom}</b><b>{usd(m.coutPhotos + m.coutMessages)}</b></div>
                  <div className="tableau">
                    <div><span>Photos lues</span><span>{nombre(m.photos)}</span><span>{usd(m.coutPhotos)}</span></div>
                    <div><span>Messages à l'assistant</span><span>{nombre(m.messages)}</span><span>{usd(m.coutMessages)}</span></div>
                    <div><span>Jetons utilisés</span><span>{nombre(m.jetons)}</span><span /></div>
                  </div>
                  {m.photos > 0 && <div className="muted">Environ {(m.coutPhotos / m.photos).toLocaleString("fr-CA", { maximumFractionDigits: 3 })} $ US par photo.</div>}
                </div>
              );
            })}
            <label>Tarifs (dollars US par million de jetons)</label>
            <div className="grid2">
              {([["sonnetEntree", "Lecture des photos, entrée"], ["sonnetSortie", "Lecture des photos, sortie"], ["haikuEntree", "Assistant, entrée"], ["haikuSortie", "Assistant, sortie"]] as const).map(([k, libelle]) => (
                <div key={k}>
                  <label>{libelle}</label>
                  <input value={tarifs[k]} inputMode="decimal" disabled={lecture} onChange={(e) => setTarifs({ ...tarifs, [k]: e.target.value })} />
                </div>
              ))}
            </div>
            <div className="muted" style={{ marginTop: 8 }}>Estimation calculée à partir des jetons comptés depuis l'ajout de ce suivi. Le montant officiel et ton solde sont dans la console Anthropic.</div>
            {!lecture && (
              <div className="actions">
                <button className="full" onClick={() => sauver({ ...reglages, tarifs: { sonnetEntree: t("sonnetEntree"), sonnetSortie: t("sonnetSortie"), haikuEntree: t("haikuEntree"), haikuSortie: t("haikuSortie") } }, "Tarifs enregistrés.")}>Enregistrer les tarifs</button>
              </div>
            )}
          </>
        )}

        {section === "acces" && (
          <>
            {!acces && <p className="muted">Chargement…</p>}
            {acces && !acces.proprietaire && (
              <div className="bloc">
                <b>Tu utilises le code d'un collègue</b>
                <div className="muted">{lecture ? "Accès en lecture seule : tu peux consulter les prix, les analyses et exporter, sans rien modifier." : "Accès complet : tu peux relever et modifier des prix."} Seul le code principal peut changer cet accès.</div>
              </div>
            )}
            {acces?.proprietaire && (
              <>
                <div className="bloc">
                  <b>{acces.collegue ? `Un code collègue est actif (${acces.collegue.role === "lecture" ? "lecture seule" : "accès complet"})` : "Aucun code collègue"}</b>
                  <div className="muted">
                    {acces.collegue
                      ? `Créé le ${momentLisible(acces.collegue.cree_le)}. Le collègue ouvre l'app avec son propre code, sans connaître le tien.`
                      : "Crée un deuxième code à 4 chiffres pour un collègue. Tu peux le limiter à la lecture seule et le retirer à tout moment."}
                  </div>
                </div>
                <form onSubmit={definirCode}>
                  <label>{acces.collegue ? "Nouveau code du collègue" : "Code du collègue"} (4 chiffres)</label>
                  <input value={code} inputMode="numeric" maxLength={4} autoComplete="off" onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="••••" />
                  <label>Type d'accès</label>
                  <select value={role} onChange={(e) => setRole(e.target.value as "lecture" | "complet")}>
                    <option value="lecture">Lecture seule (consulter et exporter)</option>
                    <option value="complet">Complet (relever et modifier)</option>
                  </select>
                  <div className="actions">
                    <button className="primary full" disabled={code.length !== 4}>{acces.collegue ? "Remplacer le code" : "Créer le code"}</button>
                    {acces.collegue && (
                      <button type="button" className="danger full" onClick={retirer ? retirerCode : () => setRetirer(true)}>
                        {retirer ? "Confirmer : retirer l'accès du collègue" : "Retirer l'accès du collègue"}
                      </button>
                    )}
                  </div>
                </form>
              </>
            )}
            <div className="actions"><button className="full ghost" onClick={verrouiller}>Verrouiller l'app sur cet appareil</button></div>
          </>
        )}

        {section === "corbeille" && (
          <>
            {jetes === null && !erreur && <p className="muted">Chargement…</p>}
            {jetes !== null && !affiches.length && (
              <div className="empty"><IEffacer /><div>La corbeille est vide.</div><div className="muted">Les prix et les visites supprimés y restent 30 jours.</div></div>
            )}
            {affiches.map((j) => {
              const d = j.donnees as Record<string, string | number | null>;
              const nbPrix = (jetes ?? []).filter((k) => k.type === "scans" && k.lot === j.lot && k.donnees.visite_id === j.objet_id).length;
              const prix = d.prix_promo ?? d.prix_regulier;
              return (
                <div key={j.id} className="tx" style={{ cursor: "default" }}>
                  <div className="ic soft">{j.type === "visites" ? <IMagasin /> : <IEtiquette />}</div>
                  <div className="mid">
                    <div className="t">{j.type === "visites" ? [d.banniere, d.magasin].filter(Boolean).join(" · ") : (d.produit || "Produit non lu")}</div>
                    <div className="s">
                      {j.type === "visites"
                        ? `Visite du ${dateLisible(String(d.date_visite))} · ${nbPrix} prix`
                        : [d.marque, d.format, prix !== null && prix !== undefined ? argent(Number(prix)) : null].filter(Boolean).join(" · ") || "Prix"}
                    </div>
                    <div className="s">Supprimé le {momentLisible(j.supprime_le)}</div>
                  </div>
                  {!lecture && <button className="small" onClick={() => restaurer(j)}><IRestaurer /> Récupérer</button>}
                </div>
              );
            })}
            {!lecture && affiches.length > 0 && (
              <div className="actions">
                <button className="danger full" onClick={vider ? viderCorbeille : () => setVider(true)}>
                  {vider ? "Confirmer : effacer définitivement" : "Vider la corbeille"}
                </button>
                {vider && <div className="muted" style={{ textAlign: "center" }}>Cette suppression est définitive : plus rien ne pourra être récupéré.</div>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
