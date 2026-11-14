"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { configOk, supabaseBrowser } from "@/lib/supabase";
import type { Scan, Visite } from "@/lib/types";

const BANNIERES = ["Metro", "Super C", "IGA", "Maxi", "Provigo", "Walmart", "Costco", "Adonis", "Marché Richelieu", "Tigre Géant", "Pharmaprix", "Jean Coutu"];

const argent = (v: number | null) =>
  v === null ? "—" : Number(v).toLocaleString("fr-CA", { style: "currency", currency: "CAD" });

const aujourdhui = () => new Date().toLocaleDateString("en-CA"); // AAAA-MM-JJ, heure locale

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

export default function Page() {
  const [session, setSession] = useState<Session | null>(null);
  const [pret, setPret] = useState(false);

  useEffect(() => {
    if (!configOk) return setPret(true);
    const sb = supabaseBrowser();
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setPret(true);
    });
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!pret) return <main><p className="muted">Chargement…</p></main>;
  if (!configOk)
    return (
      <main>
        <h1>Scan Prix</h1>
        <div className="alert">Configuration manquante : ajoute NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY (voir le README).</div>
      </main>
    );
  return session ? <App session={session} /> : <Connexion />;
}

function Connexion() {
  const [email, setEmail] = useState("");
  const [mdp, setMdp] = useState("");
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [occupe, setOccupe] = useState(false);

  async function go(creer: boolean) {
    setErreur("");
    setInfo("");
    setOccupe(true);
    const sb = supabaseBrowser();
    const { data, error } = creer
      ? await sb.auth.signUp({ email, password: mdp })
      : await sb.auth.signInWithPassword({ email, password: mdp });
    setOccupe(false);
    if (error) setErreur(error.message);
    else if (creer && !data.session) setInfo("Compte créé. Confirme ton courriel, puis connecte-toi.");
  }

  return (
    <main>
      <h1>Scan Prix</h1>
      <form className="card" onSubmit={(e) => { e.preventDefault(); go(false); }}>
        <label>Courriel</label>
        <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>Mot de passe</label>
        <input type="password" autoComplete="current-password" value={mdp} onChange={(e) => setMdp(e.target.value)} required minLength={6} />
        {erreur && <div className="alert">{erreur}</div>}
        {info && <div className="alert info">{info}</div>}
        <p><button className="primary full" disabled={occupe}>Se connecter</button></p>
        <button type="button" className="link" disabled={occupe || !email || mdp.length < 6} onClick={() => go(true)}>
          Créer un compte
        </button>
      </form>
    </main>
  );
}

function App({ session }: { session: Session }) {
  const sb = supabaseBrowser();
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

  const jeton = useCallback(async () => {
    const { data } = await sb.auth.getSession();
    return data.session?.access_token ?? session.access_token;
  }, [sb, session.access_token]);

  // Visites : on reprend la plus récente à l'ouverture
  useEffect(() => {
    sb.from("visites").select("*").order("created_at", { ascending: false }).limit(50).then(({ data, error }) => {
      if (error) return setErreur(error.message);
      const liste = (data ?? []) as Visite[];
      setVisites(liste);
      if (liste.length) setVisite(liste[0]);
      else setNouvelle(true);
    });
  }, [sb]);

  useEffect(() => {
    if (!visite) return setScans([]);
    sb.from("scans").select("*").eq("visite_id", visite.id).order("created_at", { ascending: false }).then(({ data, error }) => {
      if (error) setErreur(error.message);
      else setScans((data ?? []) as Scan[]);
    });
  }, [sb, visite]);

  // Chaque photo part en arrière-plan : on peut enchaîner les cartes sans attendre.
  async function photographier(files: FileList | null) {
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
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${await jeton()}` },
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

  async function exporter(toutes: boolean) {
    setExportEnCours(true);
    setErreur("");
    try {
      const q = !toutes && visite ? `?visite=${visite.id}` : "";
      const res = await fetch(`/api/export${q}`, { headers: { Authorization: `Bearer ${await jeton()}` } });
      if (!res.ok) throw new Error((await res.json()).error || "Export impossible");
      const blob = await res.blob();
      const nom = !toutes && visite
        ? `prix-${visite.banniere.toLowerCase().replace(/\s+/g, "-")}-${visite.date_visite}.xlsx`
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

  return (
    <main>
      <div className="row between">
        <h1>Scan Prix</h1>
        <button className="link" onClick={() => sb.auth.signOut()}>Déconnexion</button>
      </div>

      <div className="card">
        <label style={{ marginTop: 0 }}>Visite en cours</label>
        <div className="row">
          <select
            className="grow"
            value={visite?.id ?? ""}
            onChange={(e) => setVisite(visites.find((v) => v.id === e.target.value) ?? null)}
          >
            {!visites.length && <option value="">Aucune visite</option>}
            {visites.map((v) => (
              <option key={v.id} value={v.id}>
                {v.banniere}{v.magasin ? ` · ${v.magasin}` : ""} · {v.date_visite}
              </option>
            ))}
          </select>
          <button onClick={() => setNouvelle(true)}>Nouvelle</button>
        </div>
      </div>

      {erreur && <div className="alert" onClick={() => setErreur("")}>{erreur}</div>}
      {enCours > 0 && <div className="alert info">Lecture de {enCours} photo{enCours > 1 ? "s" : ""}…</div>}

      {visite && (
        <>
          <div className="row between">
            <h2>{scans.length} prix</h2>
            <div className="row">
              <button disabled={exportEnCours || !scans.length} onClick={() => exporter(false)}>Excel</button>
              <button disabled={exportEnCours} onClick={() => exporter(true)}>Excel (tout)</button>
            </div>
          </div>

          {!scans.length && !enCours && <p className="muted">Prends une photo d'une carte de prix pour commencer.</p>}

          {scans.map((s) => (
            <button key={s.id} className="card scan" onClick={() => setEdition(s)}>
              <div className="row between">
                <div className="grow">
                  <div className="nom">{s.produit || "Produit non lu"}</div>
                  <div className="muted">{[s.marque, s.format, s.cup || s.code_article].filter(Boolean).join(" · ") || "—"}</div>
                  {s.prix_promo !== null && (
                    <div className="promo">
                      Promo : {s.promo_quantite && s.promo_quantite > 1 ? `${s.promo_quantite} pour ` : ""}{argent(s.prix_promo)}
                      {s.date_fin ? ` jusqu'au ${s.date_fin}` : ""}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="prix">{argent(s.prix_regulier)}</div>
                  {s.confiance && s.confiance !== "haute" && <span className="badge">à vérifier</span>}
                </div>
              </div>
            </button>
          ))}

          <div className="dock">
            <div className="inner">
              <label className="camera">
                📷 Photographier
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => { photographier(e.target.files); e.target.value = ""; }}
                />
              </label>
            </div>
          </div>
        </>
      )}

      {nouvelle && (
        <NouvelleVisite
          fermer={visites.length ? () => setNouvelle(false) : undefined}
          creee={(v) => { setVisites((l) => [v, ...l]); setVisite(v); setNouvelle(false); }}
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
    <div className="sheet">
      <form className="panel" onSubmit={creer}>
        <h2 style={{ marginTop: 0 }}>Nouvelle visite</h2>
        <label>Bannière</label>
        <input list="bannieres" value={banniere} onChange={(e) => setBanniere(e.target.value)} required placeholder="Ex. IGA" />
        <datalist id="bannieres">{BANNIERES.map((b) => <option key={b} value={b} />)}</datalist>
        <label>Magasin (ville, succursale)</label>
        <input value={magasin} onChange={(e) => setMagasin(e.target.value)} placeholder="Ex. Mirabel" />
        <label>Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        {erreur && <div className="alert">{erreur}</div>}
        <p><button className="primary full">Commencer</button></p>
        {fermer && <button type="button" className="full" onClick={fermer}>Annuler</button>}
      </form>
    </div>
  );
}

function Edition({ scan, fermer, enregistre, supprime }: {
  scan: Scan;
  fermer: () => void;
  enregistre: (s: Scan) => void;
  supprime: (id: string) => void;
}) {
  const sb = supabaseBrowser();
  const [f, setF] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      ["produit", "marque", "format", "prix_regulier", "prix_promo", "promo_quantite", "promo_texte", "date_debut", "date_fin", "cup", "code_article", "prix_unitaire", "notes"]
        .map((k) => [k, (scan as Record<string, unknown>)[k]?.toString() ?? ""]),
    ),
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
    const maj = {
      produit: t("produit"), marque: t("marque"), format: t("format"),
      prix_regulier: n("prix_regulier"), prix_promo: n("prix_promo"),
      promo_quantite: n("promo_quantite") === null ? null : Math.trunc(n("promo_quantite")!),
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
        <div className="row between">
          <h2 style={{ margin: 0 }}>Modifier</h2>
          <button type="button" className="link" onClick={fermer}>Fermer</button>
        </div>
        {champ("produit", "Produit")}
        <div className="grid2">
          {champ("marque", "Marque")}
          {champ("format", "Format")}
          {champ("prix_regulier", "Prix régulier ($)", { inputMode: "decimal" })}
          {champ("prix_unitaire", "Prix unitaire affiché")}
          {champ("prix_promo", "Prix promo ($)", { inputMode: "decimal" })}
          {champ("promo_quantite", "Qté promo", { inputMode: "numeric" })}
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
        {erreur && <div className="alert">{erreur}</div>}
        <p><button className="primary full">Enregistrer</button></p>
        {confirmer ? (
          <button type="button" className="danger full" onClick={effacer}>Confirmer la suppression</button>
        ) : (
          <button type="button" className="danger full" onClick={() => setConfirmer(true)}>Supprimer</button>
        )}
      </form>
    </div>
  );
}
