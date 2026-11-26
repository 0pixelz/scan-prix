"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { lignesFiligrane } from "@/lib/filigrane";
import type { Acces, Reglages as TReglages, Visite } from "@/lib/types";
import type { Apparence } from "@/lib/apparence";
import { IAlerte, IAssistant, ICamera, IChevron, ICoche, IEffacer, IEtiquette, IPartage, IMagasin, IReglages, IRestaurer, argent, dateLisible, momentLisible } from "./ui";

export type Section = "apparence" | "filigrane" | "circulaires" | "cout" | "acces" | "corbeille";
const TITRES: Record<Section, string> = {
  apparence: "Apparence", filigrane: "Signature des photos", circulaires: "Circulaires et alertes",
  cout: "Lecture des photos et coût", acces: "Partage et accès collègue", corbeille: "Corbeille",
};
type Jete = { id: string; type: "visites" | "scans"; objet_id: string; donnees: Record<string, unknown>; lot: number; supprime_le: string };
type Usage = { quand: string; fonction: string; modele: string; entree: number; sortie: number; photos: number };

const nombre = (v: number) => v.toLocaleString("fr-CA");
const usd = (v: number) => `${v.toLocaleString("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $ US`;

/** Réglages : signature des photos, coût Claude, accès d'un collègue et corbeille. */
export default function Reglages({ apparence, changerApparence, reglages, enregistrer, acces, rechargerAcces, visite, restaure, verrouiller, sectionInitiale }: {
  apparence: Apparence;
  changerApparence: (a: Apparence) => void;
  reglages: TReglages;
  enregistrer: (r: TReglages) => Promise<string | null>;
  acces: Acces | null;
  rechargerAcces: () => void;
  visite: Visite | null;
  restaure: () => void;
  verrouiller: () => void;
  sectionInitiale?: Section | null;
}) {
  const sb = supabaseBrowser();
  const lecture = acces?.role === "lecture";
  // Les réglages partagés (signature, circulaires, lecteur, tarifs) ne se changent qu'avec le code principal.
  const fige = !acces?.proprietaire;
  const avis = acces && fige ? <div className="alert info">Seul le code principal peut modifier ces réglages.</div> : null;
  const [section, setSection] = useState<Section | null>(sectionInitiale ?? null);
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
    if (/gemini/i.test(u.modele)) return 0; // service de secours gratuit
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
      secours: lectures.filter((u) => /gemini/i.test(u.modele)).reduce((s, u) => s + (u.photos || 0), 0),
      messages: messages.length,
      coutPhotos: lectures.reduce((s, u) => s + cout(u), 0),
      coutMessages: messages.reduce((s, u) => s + cout(u), 0),
      jetons: lignes.reduce((s, u) => s + u.entree + u.sortie, 0),
    };
  };

  // ---------- Accès collègue ----------
  const [code, setCode] = useState("");
  const role = "complet"; // chaque téléphone a son espace privé : un accès en lecture seule serait un espace vide
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
  // Lien d'invitation : créé à la demande, affiché une seule fois (la base n'en garde que l'empreinte).
  const [lienPartage, setLienPartage] = useState("");
  const [creation, setCreation] = useState(false);
  const textePartage = "Scan Prix : ouvre ce lien pour accéder à l'app (valide 7 jours). Si tu l'ajoutes à ton écran d'accueil, touche « J'ai un lien d'invitation » et colle ce même lien.";
  async function creerLien() {
    setErreur("");
    setMessage("");
    setCreation(true);
    const { data, error } = await sb.rpc("creer_invitation");
    setCreation(false);
    if (error || !data?.ok) return setErreur(error?.message ?? "Seul le code principal peut partager l'application.");
    setLienPartage(`${window.location.origin}/#inv=${data.invitation}`);
    rechargerAcces();
  }
  async function copierLien() {
    try {
      await navigator.clipboard.writeText(lienPartage);
      setMessage("Lien copié. Colle-le dans un message à ton collègue.");
    } catch {
      setErreur("Copie impossible : sélectionne le lien et copie-le à la main.");
    }
  }
  async function partagerLien() {
    if (!navigator.share) return copierLien();
    try {
      await navigator.share({ title: "Scan Prix", text: textePartage, url: lienPartage });
    } catch {
      /* partage annulé */
    }
  }
  async function retirerCode() {
    const { data, error } = await sb.rpc("retirer_code_collegue");
    if (error || !data?.ok) return setErreur(error?.message ?? "Retrait refusé.");
    setRetirer(false);
    setLienPartage("");
    setMessage("Accès des collègues retiré : code et liens annulés, leurs appareils sont déconnectés.");
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

  const lieu = visite ? [visite.banniere, visite.magasin].filter(Boolean).join(" · ") : "Bannière · magasin de la visite";
  const apercu = lignesFiligrane(f, new Date().toISOString(), lieu);

  // Nombre d'éléments dans la corbeille, pour le menu
  const [nbCorbeille, setNbCorbeille] = useState<number | null>(null);
  useEffect(() => {
    if (section !== null) return;
    sb.from("corbeille").select("id", { count: "exact", head: true }).then(({ count }) => setNbCorbeille(count ?? 0));
  }, [sb, section]);

  // Circulaires et alertes : code postal et seuil
  const [codePostal, setCodePostal] = useState(reglages.codePostal);
  const [seuil, setSeuil] = useState(String(reglages.seuil).replace(".", ","));

  const themes = { auto: "automatique", clair: "clair", sombre: "sombre" } as const;
  const textes = { normal: "texte normal", grand: "grand texte", tresgrand: "très grand texte" } as const;
  const menu: { section: Section; icone: React.ReactNode; etat: string }[] = [
    { section: "apparence", icone: <IReglages />, etat: `Thème ${themes[apparence.theme]} · ${textes[apparence.texte]}` },
    { section: "filigrane", icone: <ICamera />, etat: reglages.filigrane.actif ? `Activée${reglages.filigrane.nom ? ` · ${reglages.filigrane.nom}` : ""}` : "Désactivée" },
    { section: "circulaires", icone: <IAlerte />, etat: `${reglages.codePostal ? `Code postal ${reglages.codePostal}` : "Code postal à entrer"} · seuil ${String(reglages.seuil).replace(".", ",")} %` },
    { section: "cout", icone: <IAssistant />, etat: `Lecture par ${reglages.lecteur === "gemini" ? "Google (gratuit)" : "Claude"} · coût estimé du mois` },
    { section: "acces", icone: <ICoche />, etat: !acces ? "…" : !acces.proprietaire ? "Espace privé de ce téléphone" : acces.collegue || acces.invitations ? `${acces.collegue ? "Code actif" : "Lien actif"} · ${acces.espaces?.length ?? 0} téléphone${(acces.espaces?.length ?? 0) > 1 ? "s" : ""}` : "Partager l'application" },
    { section: "corbeille", icone: <IEffacer />, etat: nbCorbeille === null ? "…" : nbCorbeille ? `${nbCorbeille} élément${nbCorbeille > 1 ? "s" : ""} récupérable${nbCorbeille > 1 ? "s" : ""}` : "Vide" },
  ];

  return (
    <main className="reglages">
      {section === null ? (
        <div className="card menu">
          {menu.map((m) => (
            <div key={m.section} className="tx" role="button" onClick={() => setSection(m.section)}>
              <div className="ic soft">{m.icone}</div>
              <div className="mid"><div className="t">{TITRES[m.section]}</div><div className="s">{m.etat}</div></div>
              <span className="suite"><IChevron /></span>
            </div>
          ))}
        </div>
      ) : (
        <button type="button" className="retour" onClick={() => setSection(null)}><IChevron /> Tous les réglages</button>
      )}
      <div className={section === null ? "" : "card"}>
        {section !== null && <h2>{TITRES[section]}</h2>}
        {message && <div className="alert info">{message}</div>}
        {erreur && <div className="alert" onClick={() => setErreur("")}>{erreur}</div>}

        {section === "apparence" && (
          <>
            <label>Thème</label>
            <div className="segments">
              {([["auto", "Automatique"], ["clair", "Clair"], ["sombre", "Sombre"]] as const).map(([v, libelle]) => (
                <button key={v} type="button" className={apparence.theme === v ? "on" : ""} onClick={() => changerApparence({ ...apparence, theme: v })}>{libelle}</button>
              ))}
            </div>
            <div className="muted">Automatique suit le réglage de ton iPhone. Le thème clair se lit mieux sous l'éclairage d'un magasin.</div>
            <label>Taille du texte</label>
            <div className="segments">
              {([["normal", "Normale"], ["grand", "Grande"], ["tresgrand", "Très grande"]] as const).map(([v, libelle]) => (
                <button key={v} type="button" className={apparence.texte === v ? "on" : ""} onClick={() => changerApparence({ ...apparence, texte: v })}>{libelle}</button>
              ))}
            </div>
            <div className="bloc">
              <div className="tx" style={{ cursor: "default", borderBottom: 0, padding: 0 }}>
                <div className="ic soft"><IEtiquette /></div>
                <div className="mid"><div className="t">Beurre salé</div><div className="s">Lactantia · 454 g</div></div>
                <div className="r"><b>6,49 $</b><span className="old">7,49 $</span></div>
              </div>
            </div>
            <div className="muted">Ces deux choix sont gardés sur cet appareil seulement.</div>
          </>
        )}

        {section === "circulaires" && (
          <form onSubmit={(e) => {
            e.preventDefault();
            const v = parseFloat(seuil.replace(",", "."));
            sauver({ ...reglages, codePostal: codePostal.trim().toUpperCase(), seuil: Number.isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : reglages.seuil }, "Enregistré.");
          }}>
            {avis}
            <label>Code postal (région des circulaires)</label>
            <input value={codePostal} disabled={fige} onChange={(e) => setCodePostal(e.target.value.toUpperCase())} placeholder="Ex. H2X 1Y4" maxLength={7} autoCapitalize="characters" />
            <div className="muted">Sert à chercher les promos des concurrents et les photos de produits dans les circulaires de ta région.</div>
            <label>Seuil d'alerte (%)</label>
            <input value={seuil} inputMode="decimal" disabled={fige} onChange={(e) => setSeuil(e.target.value)} />
            <div className="muted">Un écart de prix égal ou supérieur à ce pourcentage est signalé dans Alertes, l'Excel et le rapport.</div>
            {!fige && <div className="actions"><button className="primary full">Enregistrer</button></div>}
          </form>
        )}

        {section === "filigrane" && (
          <form onSubmit={(e) => { e.preventDefault(); sauver({ ...reglages, filigrane: { ...f, nom: f.nom.trim(), poste: f.poste.trim() } }, "Signature enregistrée. Elle s'applique aux prochaines photos."); }}>
            {avis}
            <label className="case"><input type="checkbox" checked={f.actif} disabled={fige} onChange={(e) => setF({ ...f, actif: e.target.checked })} />Ajouter une signature au bas des photos</label>
            {f.actif && (
              <>
                <label className="case"><input type="checkbox" checked={f.logo} disabled={fige} onChange={(e) => setF({ ...f, logo: e.target.checked })} />Afficher le logo</label>
                <label>Nom</label>
                <input value={f.nom} disabled={fige} onChange={(e) => setF({ ...f, nom: e.target.value })} placeholder="Ex. Jonathan Plouffe" maxLength={60} />
                <label>Poste ou équipe</label>
                <input value={f.poste} disabled={fige} onChange={(e) => setF({ ...f, poste: e.target.value })} placeholder="Ex. Chef gestion des prix, Équipe pricing" maxLength={60} />
                <label className="case"><input type="checkbox" checked={f.lieu} disabled={fige} onChange={(e) => setF({ ...f, lieu: e.target.checked })} />Ajouter le lieu (bannière et magasin de la visite)</label>
                <label>Transparence : {100 - f.opacite} %</label>
                <input type="range" className="curseur" min={0} max={80} step={5} value={100 - f.opacite} disabled={fige} aria-label="Transparence de la signature"
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
            {!fige && <div className="actions"><button className="primary full">Enregistrer</button></div>}
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
                    {m.secours > 0 && <div><span>dont lues par le secours</span><span>{nombre(m.secours)}</span><span>gratuit</span></div>}
                    <div><span>Messages à l'assistant</span><span>{nombre(m.messages)}</span><span>{usd(m.coutMessages)}</span></div>
                    <div><span>Jetons utilisés</span><span>{nombre(m.jetons)}</span><span /></div>
                  </div>
                  {m.photos > 0 && <div className="muted">Environ {(m.coutPhotos / m.photos).toLocaleString("fr-CA", { maximumFractionDigits: 3 })} $ US par photo.</div>}
                </div>
              );
            })}
            {avis}
            <label>Qui lit les photos en premier</label>
            <div className="segments">
              {([["claude", "Claude (précis, payant)"], ["gemini", "Google (gratuit)"]] as const).map(([v, libelle]) => (
                <button key={v} type="button" disabled={fige} className={reglages.lecteur === v ? "on" : ""}
                  onClick={() => reglages.lecteur !== v && sauver({ ...reglages, lecteur: v }, v === "gemini" ? "Google lira les photos en premier ; Claude prendra le relais s'il échoue." : "Claude lira les photos en premier.")}>{libelle}</button>
              ))}
            </div>
            <div className="muted">Google Gemini est gratuit dans ses limites quotidiennes, mais utilise les photos envoyées pour améliorer ses produits. Il faut que la clé Google soit enregistrée ; sinon Claude lit comme d'habitude.</div>
            <label>Tarifs (dollars US par million de jetons)</label>
            <div className="grid2">
              {([["sonnetEntree", "Lecture des photos, entrée"], ["sonnetSortie", "Lecture des photos, sortie"], ["haikuEntree", "Assistant, entrée"], ["haikuSortie", "Assistant, sortie"]] as const).map(([k, libelle]) => (
                <div key={k}>
                  <label>{libelle}</label>
                  <input value={tarifs[k]} inputMode="decimal" disabled={fige} onChange={(e) => setTarifs({ ...tarifs, [k]: e.target.value })} />
                </div>
              ))}
            </div>
            <div className="muted" style={{ marginTop: 8 }}>Estimation calculée à partir des jetons comptés depuis l'ajout de ce suivi. Le montant officiel et ton solde sont dans la console Anthropic.</div>
            {!fige && (
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
                <b>Tu utilises le code collègue</b>
                <div className="muted">Ce téléphone a son propre espace : tu ne vois que tes visites, tes prix et tes listes, et les autres collègues ne voient pas les tiens. {lecture ? "Accès en lecture seule : tu ne peux rien ajouter. " : ""}Le code principal voit tout et gère les réglages.</div>
              </div>
            )}
            {acces?.proprietaire && (
              <>
                <div className="bloc">
                  <b>{acces.collegue ? "Un code collègue est actif" : "Aucun code collègue"}</b>
                  <div className="muted">
                    {acces.collegue
                      ? `Créé le ${momentLisible(acces.collegue.cree_le)}. ${acces.espaces?.length ? `${acces.espaces.length} téléphone${acces.espaces.length > 1 ? "s l'ont" : " l'a"} utilisé. ` : ""}`
                      : "Crée un code à 4 chiffres à partager avec tes collègues, sans donner le tien. Tu peux le retirer à tout moment. "}
                    Chaque téléphone qui entre ce code a son espace privé : un collègue ne voit que ses propres visites, prix et listes. Toi seul vois tout, avec la mention du collègue sur ses visites.
                  </div>
                </div>
                <div className="bloc">
                  <b>Partager l'application</b>
                  <div className="muted">Crée un lien à envoyer par texto ou courriel. La personne qui l'ouvre entre sans code, avec un accès complet (relever, modifier, exporter) dans l'espace privé de son téléphone. Le lien est valide 7 jours et peut servir à plusieurs collègues.{acces.invitations ? ` ${acces.invitations} lien${acces.invitations > 1 ? "s actifs" : " actif"}.` : ""}</div>
                  {lienPartage && <input className="lien-partage" readOnly value={lienPartage} onFocus={(e) => e.target.select()} aria-label="Lien d'invitation" />}
                  <div className="actions">
                    {lienPartage ? (
                      <>
                        <button type="button" className="primary full" onClick={partagerLien}><IPartage /> Partager le lien</button>
                        <button type="button" className="full" onClick={copierLien}>Copier le lien</button>
                      </>
                    ) : (
                      <button type="button" className="primary full" disabled={creation} onClick={creerLien}>{creation ? "Création…" : "Créer un lien de partage"}</button>
                    )}
                  </div>
                </div>
                <form onSubmit={definirCode}>
                  <label>{acces.collegue ? "Nouveau code du collègue" : "Code du collègue"} (4 chiffres)</label>
                  <input value={code} inputMode="numeric" maxLength={4} autoComplete="off" onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="••••" />
                  <div className="actions">
                    <button className="primary full" disabled={code.length !== 4}>{acces.collegue ? "Remplacer le code" : "Créer le code"}</button>
                    {(acces.collegue || !!acces.invitations || !!acces.espaces?.length) && (
                      <button type="button" className="danger full" onClick={retirer ? retirerCode : () => setRetirer(true)}>
                        {retirer ? "Confirmer : retirer l'accès des collègues" : "Retirer l'accès des collègues (code et liens)"}
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
    </main>
  );
}
