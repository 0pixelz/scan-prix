"use client";

import { useEffect, useRef, useState } from "react";
import { ICamera } from "./ui";

/**
 * Caméra en continu : chaque appui sur le déclencheur capture une carte et l'envoie en lecture,
 * sans quitter la caméra. Si la caméra en continu est refusée, on retombe sur l'appareil photo de l'iPhone.
 */
export default function Rafale({ fermer, photo, enCours }: {
  fermer: () => void;
  photo: (fichiers: File[]) => void;
  enCours: number;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [pret, setPret] = useState(false);
  const [erreur, setErreur] = useState(false);
  const [prises, setPrises] = useState(0);
  const [eclair, setEclair] = useState(false);

  useEffect(() => {
    let flux: MediaStream | undefined;
    let fini = false;
    if (!navigator.mediaDevices?.getUserMedia) return setErreur(true);
    navigator.mediaDevices
      .getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1440 } } })
      .then((s) => {
        if (fini) return s.getTracks().forEach((t) => t.stop());
        flux = s;
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

  function prendre() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    canvas.toBlob((b) => b && photo([new File([b], `carte-${Date.now()}.jpg`, { type: "image/jpeg" })]), "image/jpeg", 0.9);
    setPrises((n) => n + 1);
    setEclair(true);
    setTimeout(() => setEclair(false), 120);
  }

  return (
    <div className="rafale">
      <div className="haut">
        <span>
          {prises ? `${prises} photo${prises > 1 ? "s" : ""}` : "Vise une carte de prix"}
          {enCours > 0 ? ` · ${enCours} en lecture` : prises ? " · tout est lu" : ""}
        </span>
        <button onClick={fermer}>Terminer</button>
      </div>
      {erreur ? (
        <div className="secours">
          <p>La caméra en continu n'est pas disponible. Autorise l'accès à la caméra pour ce site, ou utilise l'appareil photo de l'iPhone.</p>
          <label>
            <ICamera /> Ouvrir l'appareil photo
            <input type="file" accept="image/*" capture="environment" onChange={(e) => { if (e.target.files?.length) { photo(Array.from(e.target.files)); setPrises((n) => n + 1); } e.target.value = ""; }} />
          </label>
        </div>
      ) : (
        <>
          <video ref={video} playsInline muted autoPlay onLoadedMetadata={() => setPret(true)} />
          {eclair && <div className="eclair" />}
          <div className="bas">
            <button className="declencheur" aria-label="Prendre la photo" disabled={!pret} onClick={prendre}><span /></button>
          </div>
        </>
      )}
    </div>
  );
}
