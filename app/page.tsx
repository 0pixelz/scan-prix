"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { configOk, supabaseBrowser } from "@/lib/supabase";
import type { Scan, Visite } from "@/lib/types";

const BANNIERES = ["Metro", "Super C", "IGA", "Maxi", "Provigo", "Walmart", "Costco", "Adonis", "Marché Richelieu", "Tigre Géant", "Pharmaprix", "Jean Coutu"];

const SUGGESTIONS = [
  "Résume cette visite",
  "Quels produits sont en promotion ?",
  "Quels prix sont à vérifier ?",
  "Compare avec mes autres visites",
];

type Onglet = "scan" | "assistant" | "visites";
type Message = { role: "user" | "assistant"; content: string };

const argent = (v: number | null) =>
  v === null ? "—" : Number(v).toLocaleString("fr-CA", { style: "currency", currency: "CAD" });

const aujourdhui = () => new Date().toLocaleDateString("en-CA"); // AAAA-MM-JJ, heure locale

const dateLisible = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("fr-CA", { day: "numeric", month: "short", year: "numeric" });

/** Prix promo ramené à l'unité (2 pour 5 $ -> 2,50 $). */
const promoUnitaire = (s: Scan) =>
  s.prix_promo === null ? null : Number(s.prix_promo) / (s.promo_quantite && s.promo_quantite > 1 ? s.promo_quantite : 1);

/** Réduit la photo (max 1568 px) pour un envoi rapide sur réseau cellulaire. */
async function reduire(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const ratio = Math.min(1, 1568 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * ratio);
    canvas.height = Math.round(img.naturalHeight * ratio);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* Icônes au trait */
const Icone = ({ d }: { d: string[] }) => (
  <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
    {d.map((p) => <path key={p} d={p} />)}
  </svg>
);
const ICamera = () => <Icone d={["M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z", "M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"]} />;
const IEtiquette = () => <Icone d={["M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z", "M7.5 7.5h.01"]} />;
const IAssistant = () => <Icone d={["M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z", "M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"]} />;
const IMagasin = () => <Icone d={["M4 9l1.2-5h13.6L20 9", "M4 9v11h16V9", "M4 9a2.7 2.7 0 0 0 5.33 0 2.7 2.7 0 0 0 5.34 0A2.7 2.7 0 0 0 20 9", "M9.5 20v-5h5v5"]} />;
const IEnvoyer = () => <Icone d={["M12 19V5", "M6 11l6-6 6 6"]} />;
const IPlus = () => <Icone d={["M12 5v14", "M5 12h14"]} />;
const IExport = () => <Icone d={["M12 4v11", "M7.5 10.5L12 15l4.5-4.5", "M5 20h14"]} />;

export default function Page() {
  if (!configOk)
    return (
      <div className="app">
        <header><h1>Scan Prix</h1></header>
        <main><div className="alert">Configuration manquante : ajoute NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY (voir le README).</div></main>
      </div>
    );
  return <App />;
}

function App() {
  const sb = supabaseBrowser();
  const [onglet, setOnglet] = useState<Onglet>("scan");
  const [visites, setVisites] = useState<Visite[]>([]);
  const [visite, setVisite] = useState<Visite | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [enCours, setEnCours] = useState(0);
  const [erreur, setErreur] = useState("");
  const [edition, setEdition] = useState<Scan | null>(null);
  const [nouvelle, setNouvelle] = useState(false);
  const [exportEnCours, setExportEnCours] = useState(false);
  const visiteRef = useRef<Visite | null>(null);
  visiteRef.current = visite;

  // Visites : on reprend la plus récente à l'ouverture
  useEffect(() => {
    sb.from("visites").select("*").order("created_at", { ascending: false }).limit(100).then(({ data, error }) => {
      if (error) return setErreur(error.message);
      const liste = (data ?? []) as Visite[];
      setVisites(liste);
      if (liste.length) setVisite(liste[0]);
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

  useEffect(() => { chargerScans(); }, [chargerScans, visite]);

  // Chaque photo part en arrière-plan : on peut enchaîner les cartes sans attendre.
  function photographier(files: FileList | null) {
    const v = visiteRef.current;
    if (!files?.length || !v) return;
    setErreur("");
    for (const file of Array.from(files)) {
      setEnCours((n) => n + 1);
      (async () => {
        try {
          const image = await reduire(file);
          const res = await fetch("/api/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image, visiteId: v.id }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || "Erreur du serveur");
          if (!json.scans.length) setErreur(json.message || "Aucune carte de prix lisible.");
          else if (visiteRef.current?.id === v.id) setScans((s) => [...json.scans, ...s]);
        } catch (e) {
          setErreur(e instanceof Error ? e.message : "Erreur inconnue");
        } finally {
          setEnCours((n) => n - 1);
        }
      })();
    }
  }

  async function exporter(v: Visite | null) {
    setExportEnCours(true);
    setErreur("");
    try {
      const res = await fetch(`/api/export${v ? `?visite=${v.id}` : ""}`);
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

  const nbPromos = scans.filter((s) => s.prix_promo !== null).length;
  const nbVerif = scans.filter((s) => s.confiance && s.confiance !== "haute").length;
  const titres: Record<Onglet, string> = { scan: "Scan Prix", assistant: "Assistant", visites: "Visites" };

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

              <div className="card">
                <h2>Prix relevés</h2>
                {!scans.length && (
                  <div className="empty">
                    <IEtiquette />
                    <div>Aucun prix pour l'instant.</div>
                    <div className="muted">Photographie une carte de prix pour commencer.</div>
                  </div>
                )}
                {scans.map((s) => {
                  const pu = promoUnitaire(s);
                  return (
                    <div key={s.id} className="tx" role="button" onClick={() => setEdition(s)}>
                      <div className="ic">{(s.produit || "?").trim().charAt(0).toUpperCase()}</div>
                      <div className="mid">
                        <div className="t">{s.produit || "Produit non lu"}</div>
                        <div className="s">{[s.marque, s.format, s.cup || s.code_article].filter(Boolean).join(" · ") || "Aucun détail"}</div>
                        {s.prix_promo !== null && (
                          <span className="pill promo">
                            {s.promo_quantite && s.promo_quantite > 1 ? `${s.promo_quantite} pour ${argent(s.prix_promo)}` : "Promo"}
                            {s.date_fin ? ` · jusqu'au ${dateLisible(s.date_fin)}` : ""}
                          </span>
                        )}{" "}
                        {s.confiance && s.confiance !== "haute" && <span className="pill verif">À vérifier</span>}
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

      {onglet === "assistant" && <Assistant visite={visite} modifie={chargerScans} />}

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
        </main>
      )}

      {onglet === "scan" && visite && (
        <div className="fab">
          <label>
            <ICamera /> Photographier
            <input type="file" accept="image/*" capture="environment" onChange={(e) => { photographier(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
      )}

      <nav>
        <button className={onglet === "scan" ? "on" : ""} onClick={() => setOnglet("scan")}><IEtiquette />Prix</button>
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
        />
      )}
    </div>
  );
}

function Assistant({ visite, modifie }: { visite: Visite | null; modifie: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [texte, setTexte] = useState("");
  const [attente, setAttente] = useState(false);
  const fin = useRef<HTMLDivElement>(null);

  useEffect(() => { fin.current?.scrollIntoView({ block: "end" }); }, [messages, attente]);

  async function envoyer(contenu: string) {
    const question = contenu.trim();
    if (!question || attente) return;
    const suite: Message[] = [...messages, { role: "user", content: question }];
    setMessages(suite);
    setTexte("");
    setAttente(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: suite, visiteId: visite?.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erreur du serveur");
      setMessages([...suite, { role: "assistant", content: json.reponse }]);
      if (json.modifie) modifie();
    } catch (e) {
      setMessages([...suite, { role: "assistant", content: e instanceof Error ? e.message : "Erreur inconnue" }]);
    } finally {
      setAttente(false);
    }
  }

  return (
    <main className="chatmain">
      <div className="chat">
        {!messages.length && (
          <div className="hero">
            <div className="logo"><IAssistant /></div>
            <h3>Comment puis-je t'aider ?</h3>
            <div className="muted">Pose une question sur tes prix, ou demande une correction.</div>
            <div className="herogrid">
              {SUGGESTIONS.map((s) => <button key={s} onClick={() => envoyer(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {messages.map((m, i) => <div key={i} className={`bub ${m.role === "user" ? "me" : "ai"}`}>{m.content}</div>)}
        {attente && <div className="bub typing">Claude réfléchit…</div>}
        <div ref={fin} />
      </div>
      <div className="chatfoot">
        <form className="chatbar" onSubmit={(e) => { e.preventDefault(); envoyer(texte); }}>
          <textarea
            rows={1}
            value={texte}
            placeholder="Écris ta question…"
            onChange={(e) => setTexte(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); envoyer(texte); } }}
          />
          <button aria-label="Envoyer" disabled={attente || !texte.trim()}><IEnvoyer /></button>
        </form>
        <div className="pbc">Propulsé par Claude</div>
      </div>
    </main>
  );
}

function NouvelleVisite({ fermer, creee }: { fermer?: () => void; creee: (v: Visite) => void }) {
  const [banniere, setBanniere] = useState("");
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
        <input list="bannieres" value={banniere} onChange={(e) => setBanniere(e.target.value)} required placeholder="Ex. IGA" />
        <datalist id="bannieres">{BANNIERES.map((b) => <option key={b} value={b} />)}</datalist>
        <label>Magasin (ville, succursale)</label>
        <input value={magasin} onChange={(e) => setMagasin(e.target.value)} placeholder="Ex. Mirabel" />
        <label>Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        {erreur && <div className="alert" style={{ marginTop: 12 }}>{erreur}</div>}
        <div className="actions">
          <button className="primary full">Commencer</button>
          {fermer && <button type="button" className="full" onClick={fermer}>Annuler</button>}
        </div>
      </form>
    </div>
  );
}

const CHAMPS_EDITION = ["produit", "marque", "format", "prix_regulier", "prix_promo", "promo_quantite", "promo_texte", "date_debut", "date_fin", "cup", "code_article", "prix_unitaire", "notes"];

function Edition({ scan, fermer, enregistre, supprime }: {
  scan: Scan;
  fermer: () => void;
  enregistre: (s: Scan) => void;
  supprime: (id: string) => void;
}) {
  const sb = supabaseBrowser();
  const [f, setF] = useState<Record<string, string>>(() =>
    Object.fromEntries(CHAMPS_EDITION.map((k) => [k, (scan as Record<string, unknown>)[k]?.toString() ?? ""])),
  );
  const [photo, setPhoto] = useState<string | null>(null);
  const [erreur, setErreur] = useState("");
  const [confirmer, setConfirmer] = useState(false);

  useEffect(() => {
    if (!scan.photo_path) return;
    sb.storage.from("photos").createSignedUrl(scan.photo_path, 600).then(({ data }) => setPhoto(data?.signedUrl ?? null));
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
    const maj = {
      produit: t("produit"), marque: t("marque"), format: t("format"),
      prix_regulier: n("prix_regulier"), prix_promo: n("prix_promo"),
      promo_quantite: qte === null ? null : Math.trunc(qte),
      promo_texte: t("promo_texte"), date_debut: t("date_debut"), date_fin: t("date_fin"),
      cup: t("cup"), code_article: t("code_article"), prix_unitaire: t("prix_unitaire"), notes: t("notes"),
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
          {champ("prix_regulier", "Prix régulier ($)", { inputMode: "decimal" })}
          {champ("prix_unitaire", "Prix unitaire affiché")}
          {champ("prix_promo", "Prix promo ($)", { inputMode: "decimal" })}
          {champ("promo_quantite", "Quantité promo", { inputMode: "numeric" })}
        </div>
        {champ("promo_texte", "Offre")}
        <div className="grid2">
          {champ("date_debut", "Début", { type: "date" })}
          {champ("date_fin", "Fin", { type: "date" })}
          {champ("cup", "CUP", { inputMode: "numeric" })}
          {champ("code_article", "Code article")}
        </div>
        {champ("notes", "Notes")}
        {photo && <img className="photo" src={photo} alt="Photo de la carte de prix" />}
        {erreur && <div className="alert" style={{ marginTop: 12 }}>{erreur}</div>}
        <div className="actions">
          <button className="primary full">Enregistrer</button>
          <button type="button" className="danger full" onClick={confirmer ? effacer : () => setConfirmer(true)}>
            {confirmer ? "Confirmer la suppression" : "Supprimer"}
          </button>
        </div>
      </form>
    </div>
  );
}
