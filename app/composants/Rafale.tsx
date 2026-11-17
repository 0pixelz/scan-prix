"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HAUTEUR, IMAGES_STABLES, LARGEUR, SEUIL_DEPLACEMENT, SEUIL_IMMOBILE, analyser, ecart, enGris, grossier } from "@/lib/detection";
import { ICamera } from "./ui";

const CLE_AUTO = "scanprix.auto";
type Etat = "cherche" | "stable" | "attente";

/**
 * Scanner en continu : un cadre de visée, et la photo se prend toute seule quand une carte de prix
 * est bien cadrée et immobile (mode Auto). Seul le contenu du cadre est envoyé en lecture.
 * Le déclencheur manuel reste toujours disponible.
 */
export default function Rafale({ fermer, photo, enCours }: {
  fermer: () => void;
  photo: (fichiers: File[]) => void;
  enCours: number;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const cadre = useRef<HTMLDivElement>(null);
  const piste = useRef<MediaStreamTrack | null>(null);
  const [pret, setPret] = useState(false);
  const [erreur, setErreur] = useState(false);
  const [prises, setPrises] = useState(0);
  const [eclair, setEclair] = useState(false);
  const [vignette, setVignette] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [etat, setEtat] = useState<Etat>("cherche");
  const [progres, setProgres] = useState(0);
  const [torche, setTorche] = useState<boolean | null>(null); // null : lampe non disponible
  const armee = useRef(true); // faux après une capture, jusqu'à ce que la caméra se déplace

  useEffect(() => {
    try { setAuto(localStorage.getItem(CLE_AUTO) !== "non"); } catch { /* stockage indisponible */ }
    let flux: MediaStream | undefined;
    let fini = false;
    if (!navigator.mediaDevices?.getUserMedia) return setErreur(true);
    navigator.mediaDevices
      .getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1440 } } })
      .then((s) => {
        if (fini) return s.getTracks().forEach((t) => t.stop());
        flux = s;
        piste.current = s.getVideoTracks()[0] ?? null;
        const capacites = piste.current?.getCapabilities?.() as { torch?: boolean } | undefined;
        if (capacites?.torch) setTorche(false);
        if (video.current) {
          video.current.srcObject = s;
          video.current.play().catch(() => {});
        }
      })
      .catch(() => setErreur(true));
    return () => {
      fini = true;
      flux?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  /** Zone de la vidéo (en pixels vidéo) qui correspond au cadre affiché, avec une petite marge. */
  const zone = useCallback((marge: number) => {
    const v = video.current;
    const c = cadre.current;
    if (!v || !c || !v.videoWidth) return null;
    const rv = v.getBoundingClientRect();
    const rc = c.getBoundingClientRect();
    const echelle = Math.max(rv.width / v.videoWidth, rv.height / v.videoHeight); // la vidéo couvre l'écran
    const ox = (rv.width - v.videoWidth * echelle) / 2;
    const oy = (rv.height - v.videoHeight * echelle) / 2;
    let w = rc.width / echelle;
    let h = rc.height / echelle;
    let x = (rc.left - rv.left - ox) / echelle - w * marge;
    let y = (rc.top - rv.top - oy) / echelle - h * marge;
    w *= 1 + 2 * marge;
    h *= 1 + 2 * marge;
    x = Math.max(0, x);
    y = Math.max(0, y);
    return { x, y, w: Math.min(v.videoWidth - x, w), h: Math.min(v.videoHeight - y, h) };
  }, []);

  const prendre = useCallback(() => {
    const z = zone(0.08);
    if (!z || !video.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(z.w);
    canvas.height = Math.round(z.h);
    canvas.getContext("2d")!.drawImage(video.current, z.x, z.y, z.w, z.h, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((b) => b && photo([new File([b], `carte-${Date.now()}.jpg`, { type: "image/jpeg" })]), "image/jpeg", 0.92);
    const mini = document.createElement("canvas");
    mini.width = 120;
    mini.height = Math.round((120 * z.h) / z.w);
    mini.getContext("2d")!.drawImage(canvas, 0, 0, mini.width, mini.height);
    setVignette(mini.toDataURL("image/jpeg", 0.7));
    setPrises((n) => n + 1);
    setEclair(true);
    setTimeout(() => setEclair(false), 140);
    armee.current = false;
    setEtat("attente");
    setProgres(0);
  }, [photo, zone]);

  // Mode Auto : on mesure le contenu du cadre plusieurs fois par seconde.
  useEffect(() => {
    if (!pret || !auto || erreur) return;
    const echantillon = document.createElement("canvas");
    echantillon.width = LARGEUR;
    echantillon.height = HAUTEUR;
    const ctx = echantillon.getContext("2d", { willReadFrequently: true })!;
    let precedente: Float32Array | null = null;
    let stables = 0;
    let deplacements = 0;
    const minuterie = setInterval(() => {
      const z = zone(0);
      if (!z || !video.current) return;
      ctx.drawImage(video.current, z.x, z.y, z.w, z.h, 0, 0, LARGEUR, HAUTEUR);
      const gris = enGris(ctx.getImageData(0, 0, LARGEUR, HAUTEUR).data);
      const grille = grossier(gris);
      const mouvement = precedente ? ecart(grille, precedente) : 99;
      precedente = grille;

      if (!armee.current) {
        // Après une capture, on attend que la caméra se déplace vers une autre carte.
        deplacements = mouvement > SEUIL_DEPLACEMENT ? deplacements + 1 : 0;
        if (deplacements >= 2) {
          armee.current = true;
          deplacements = 0;
          setEtat("cherche");
        }
        return;
      }
      if (analyser(gris).carte && mouvement < SEUIL_IMMOBILE) {
        stables++;
        setEtat("stable");
        setProgres(stables / IMAGES_STABLES);
        if (stables >= IMAGES_STABLES) {
          stables = 0;
          prendre();
        }
      } else {
        stables = 0;
        setEtat("cherche");
        setProgres(0);
      }
    }, 160);
    return () => clearInterval(minuterie);
  }, [pret, auto, erreur, zone, prendre]);

  function basculerAuto() {
    const suivant = !auto;
    setAuto(suivant);
    armee.current = true;
    setEtat("cherche");
    setProgres(0);
    try { localStorage.setItem(CLE_AUTO, suivant ? "oui" : "non"); } catch { /* stockage indisponible */ }
  }

  async function basculerTorche() {
    if (torche === null || !piste.current) return;
    try {
      await piste.current.applyConstraints({ advanced: [{ torch: !torche } as MediaTrackConstraintSet] });
      setTorche(!torche);
    } catch {
      setTorche(null);
    }
  }

  const conseil = !auto
    ? "Cadre la carte, puis appuie sur le bouton"
    : etat === "stable"
      ? "Ne bouge plus…"
      : etat === "attente"
        ? "Capturée. Passe à la carte suivante."
        : "Place une carte de prix dans le cadre";

  return (
    <div className="rafale">
      {erreur ? (
        <>
          <div className="haut"><span /><button onClick={fermer}>Terminer</button></div>
          <div className="secours">
            <p>La caméra en continu n'est pas disponible. Autorise l'accès à la caméra pour ce site, ou utilise l'appareil photo de l'iPhone.</p>
            <label>
              <ICamera /> Ouvrir l'appareil photo
              <input type="file" accept="image/*" capture="environment" onChange={(e) => { if (e.target.files?.length) { photo(Array.from(e.target.files)); setPrises((n) => n + 1); } e.target.value = ""; }} />
            </label>
          </div>
        </>
      ) : (
        <>
          <video ref={video} playsInline muted autoPlay onLoadedMetadata={() => setPret(true)} />
          <div ref={cadre} className={`cadre ${auto ? etat : "manuel"}`}>
            <i className="hg" /><i className="hd" /><i className="bg" /><i className="bd" />
            {auto && etat === "cherche" && <span className="balayage" />}
          </div>
          {eclair && <div className="eclair" />}

          <div className="haut">
            <span className="compteur">
              {prises ? `${prises} photo${prises > 1 ? "s" : ""}` : "Scanner"}
              {enCours > 0 ? ` · ${enCours} en lecture` : prises ? " · tout est lu" : ""}
            </span>
            <button onClick={fermer}>Terminer</button>
          </div>

          <div className={`conseil ${auto ? etat : ""}`} role="status">{conseil}</div>

          <div className="bas">
            <div className="cote gauche">
              {vignette && <img src={vignette} alt="Dernière carte capturée" />}
            </div>
            <button className="declencheur" aria-label="Prendre la photo" disabled={!pret} onClick={prendre}>
              <svg viewBox="0 0 88 88" aria-hidden="true">
                <circle cx="44" cy="44" r="40" className="piste" />
                <circle cx="44" cy="44" r="40" className="avance" style={{ strokeDashoffset: 251.3 * (1 - Math.min(1, progres)) }} />
              </svg>
              <span />
            </button>
            <div className="cote droite">
              <button className={`bascule ${auto ? "on" : ""}`} aria-pressed={auto} onClick={basculerAuto}>Auto</button>
              {torche !== null && (
                <button className={`bascule ${torche ? "on" : ""}`} aria-pressed={torche} onClick={basculerTorche}>Lampe</button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
