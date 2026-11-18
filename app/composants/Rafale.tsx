"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HAUTEUR, IMAGES_STABLES, LARGEUR, SEUIL_DEPLACEMENT, SEUIL_IMMOBILE, analyser, bandeCarte, ecart, enGris, grossier, zoomPour } from "@/lib/detection";
import { ICamera } from "./ui";

const CLE_AUTO = "scanprix.auto";
type Etat = "cherche" | "zoom" | "stable" | "attente";
const PALIERS = [1, 2, 3];

/**
 * Scanner en continu : un cadre de visée, et la photo se prend toute seule quand une carte de prix
 * est bien cadrée et immobile (mode Auto). Si la carte est petite dans le cadre (on est loin), le zoom
 * s'ajuste tout seul. Zoom manuel : boutons 1×, 2×, 3× ou pincement. Seul le contenu du cadre est envoyé en lecture.
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
  // Zoom : celui choisi à la main, multiplié par le zoom automatique (carte éloignée).
  const [zoom, setZoom] = useState(1); // zoom total affiché
  const manuel = useRef(1);
  const automatique = useRef(1);
  const materiel = useRef<{ min: number; max: number; base: number } | null>(null); // zoom de l'appareil photo, s'il existe
  const zoomMax = useRef(4);
  const [echelle, setEchelle] = useState(1); // zoom numérique (agrandissement de l'image) quand l'appareil n'a pas de zoom

  const appliquerZoom = useCallback(() => {
    const z = Math.max(1, Math.min(zoomMax.current, manuel.current * automatique.current));
    setZoom(z);
    const m = materiel.current;
    if (m && piste.current) {
      piste.current.applyConstraints({ advanced: [{ zoom: Math.min(m.max, m.base * z) } as MediaTrackConstraintSet] }).catch(() => {
        materiel.current = null; // zoom de l'appareil refusé : on passe au zoom numérique
        setEchelle(z);
      });
    } else {
      setEchelle(z);
    }
  }, []);

  useEffect(() => {
    try { setAuto(localStorage.getItem(CLE_AUTO) !== "non"); } catch { /* stockage indisponible */ }
    let flux: MediaStream | undefined;
    let fini = false;
    if (!navigator.mediaDevices?.getUserMedia) return setErreur(true);
    navigator.mediaDevices
      .getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } } })
      .then((s) => {
        if (fini) return s.getTracks().forEach((t) => t.stop());
        flux = s;
        piste.current = s.getVideoTracks()[0] ?? null;
        const capacites = piste.current?.getCapabilities?.() as { torch?: boolean; zoom?: { min: number; max: number } } | undefined;
        if (capacites?.torch) setTorche(false);
        if (capacites?.zoom && capacites.zoom.max > capacites.zoom.min) {
          const base = Math.max(1, capacites.zoom.min);
          materiel.current = { min: capacites.zoom.min, max: capacites.zoom.max, base };
          zoomMax.current = Math.min(6, capacites.zoom.max / base);
        }
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
    let loin = 0; // mesures consécutives où la carte est petite dans le cadre
    let perdue = 0; // mesures consécutives sans carte alors que le zoom automatique est actif
    let zoomBloque = false; // après un zoom automatique sans résultat, on attend que la caméra se déplace
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
          if (automatique.current !== 1) {
            automatique.current = 1; // nouvelle carte : on repart du zoom choisi à la main
            appliquerZoom();
          }
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
        setProgres(0);
        // Carte petite dans le cadre et caméra à peu près immobile : on est loin, on zoome.
        const b = mouvement < SEUIL_IMMOBILE * 1.5 ? bandeCarte(gris) : null;
        if (mouvement > SEUIL_DEPLACEMENT) zoomBloque = false;
        const facteur = b && !zoomBloque ? zoomPour(b) : 1;
        if (facteur > 1 && manuel.current * automatique.current < zoomMax.current - 0.05) {
          perdue = 0;
          if (++loin >= 3) {
            loin = 0;
            automatique.current = Math.min(zoomMax.current / manuel.current, automatique.current * facteur);
            appliquerZoom();
            setEtat("zoom");
          }
        } else {
          loin = 0;
          // Plus rien dans le cadre depuis environ deux secondes : on annule le zoom automatique.
          if (automatique.current > 1 && ++perdue >= 12) {
            perdue = 0;
            automatique.current = 1;
            zoomBloque = true;
            appliquerZoom();
          }
          setEtat((e) => (e === "zoom" && automatique.current > 1 ? "zoom" : "cherche"));
        }
      }
    }, 160);
    return () => clearInterval(minuterie);
  }, [pret, auto, erreur, zone, prendre, appliquerZoom]);

  function choisirZoom(z: number) {
    manuel.current = Math.max(1, Math.min(zoomMax.current, z));
    automatique.current = 1;
    appliquerZoom();
  }

  // Pincement à deux doigts sur l'image pour zoomer.
  const doigts = useRef(new Map<number, { x: number; y: number }>());
  const pince = useRef<{ distance: number; zoom: number } | null>(null);
  const ecartDoigts = () => {
    const p = [...doigts.current.values()];
    return p.length < 2 ? 0 : Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  };
  function doigtPose(ev: React.PointerEvent) {
    doigts.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (doigts.current.size === 2) pince.current = { distance: ecartDoigts(), zoom: manuel.current * automatique.current };
  }
  function doigtBouge(ev: React.PointerEvent) {
    if (!doigts.current.has(ev.pointerId)) return;
    doigts.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pince.current && doigts.current.size === 2 && pince.current.distance > 0) {
      choisirZoom((pince.current.zoom * ecartDoigts()) / pince.current.distance);
    }
  }
  function doigtLeve(ev: React.PointerEvent) {
    doigts.current.delete(ev.pointerId);
    if (doigts.current.size < 2) pince.current = null;
  }

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
      : etat === "zoom"
        ? "Carte éloignée : zoom automatique"
        : etat === "attente"
          ? "Capturée. Passe à la carte suivante."
        : "Place une carte de prix dans le cadre";

  return (
    <div className="rafale" onPointerDown={doigtPose} onPointerMove={doigtBouge} onPointerUp={doigtLeve} onPointerCancel={doigtLeve}>
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
          <video ref={video} playsInline muted autoPlay onLoadedMetadata={() => setPret(true)} style={{ transform: `scale(${echelle})` }} />
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

          <div className="zooms" role="group" aria-label="Zoom">
            {PALIERS.filter((z) => z <= zoomMax.current).map((z) => (
              <button key={z} className={Math.abs(zoom - z) < 0.05 ? "on" : ""} onClick={() => choisirZoom(z)}>{z}×</button>
            ))}
            {!PALIERS.some((z) => Math.abs(zoom - z) < 0.05) && <span>{zoom.toFixed(1).replace(".", ",")}×</span>}
          </div>

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
