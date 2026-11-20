"use client";

import { useRef, useState } from "react";

type Action = { libelle: string; action: () => void };

/**
 * Ligne qu'on glisse du doigt : vers la gauche pour l'action « gauche » (supprimer),
 * vers la droite pour l'action « droite » (marquer vérifié). Sans action, la ligne ne bouge pas.
 */
export function Glissable({ children, gauche, droite }: { children: React.ReactNode; gauche?: Action; droite?: Action }) {
  const [dx, setDx] = useState(0);
  const [anime, setAnime] = useState(false);
  const depart = useRef<{ x: number; y: number; sens: "h" | "v" | null } | null>(null);
  const bouge = useRef(false);
  const SEUIL = 84;

  if (!gauche && !droite) return <>{children}</>;

  const debut = (e: React.TouchEvent) => {
    const t = e.touches[0];
    depart.current = { x: t.clientX, y: t.clientY, sens: null };
    bouge.current = false;
    setAnime(false);
  };
  const mouvement = (e: React.TouchEvent) => {
    const d = depart.current;
    if (!d) return;
    const t = e.touches[0];
    const mx = t.clientX - d.x, my = t.clientY - d.y;
    if (!d.sens) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      d.sens = Math.abs(mx) > Math.abs(my) * 1.3 ? "h" : "v";
    }
    if (d.sens !== "h") return;
    bouge.current = true;
    e.stopPropagation(); // pas de « tirer pour actualiser » pendant un glissement de côté
    setDx(Math.max(gauche ? -150 : 0, Math.min(droite ? 150 : 0, mx)));
  };
  const fin = () => {
    const d = depart.current;
    depart.current = null;
    if (d?.sens !== "h") return;
    setAnime(true);
    if (dx <= -SEUIL && gauche) {
      setDx(-window.innerWidth);
      setTimeout(() => { gauche.action(); setAnime(false); setDx(0); }, 180);
    } else if (dx >= SEUIL && droite) {
      setDx(0);
      droite.action();
    } else setDx(0);
  };

  return (
    <div className="glisse" onTouchStart={debut} onTouchMove={mouvement} onTouchEnd={fin} onTouchCancel={fin}
      onClickCapture={(e) => { if (bouge.current) { e.stopPropagation(); e.preventDefault(); bouge.current = false; } }}>
      {dx < 0 && gauche && <div className={`fond suppr ${dx <= -SEUIL ? "pret" : ""}`}>{gauche.libelle}</div>}
      {dx > 0 && droite && <div className={`fond ok ${dx >= SEUIL ? "pret" : ""}`}>{droite.libelle}</div>}
      <div className="avant" style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: anime ? "transform 0.18s ease-out" : undefined }}>{children}</div>
    </div>
  );
}

/** Zone principale d'un onglet, avec « tirer vers le bas pour actualiser ». */
export function Principal({ children, rafraichir, className }: { children: React.ReactNode; rafraichir: () => Promise<unknown>; className?: string }) {
  const [tire, setTire] = useState(0);
  const [actif, setActif] = useState(false);
  const depart = useRef<{ x: number; y: number } | null>(null);
  const SEUIL = 64;

  const debut = (e: React.TouchEvent<HTMLElement>) => {
    depart.current = e.currentTarget.scrollTop <= 0 && !actif ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  };
  const mouvement = (e: React.TouchEvent<HTMLElement>) => {
    const d = depart.current;
    if (!d) return;
    const my = e.touches[0].clientY - d.y, mx = e.touches[0].clientX - d.x;
    if (my <= 0 || Math.abs(mx) > my || e.currentTarget.scrollTop > 0) {
      if (tire) setTire(0);
      if (my < -4 || Math.abs(mx) > my + 8) depart.current = null;
      return;
    }
    setTire(Math.min(96, my * 0.5));
  };
  const fin = async () => {
    depart.current = null;
    if (tire < SEUIL) return setTire(0);
    setActif(true);
    setTire(48);
    try { await Promise.all([rafraichir(), new Promise((r) => setTimeout(r, 500))]); } catch { /* l'erreur est affichée ailleurs */ }
    setActif(false);
    setTire(0);
  };

  return (
    <main className={className} onTouchStart={debut} onTouchMove={mouvement} onTouchEnd={fin} onTouchCancel={fin}>
      <div className={`tirer ${actif ? "actif" : ""}`} style={{ height: tire, transition: depart.current ? undefined : "height 0.2s ease-out" }} aria-live="polite">
        {tire > 12 && <span><i />{actif ? "Actualisation…" : tire >= SEUIL ? "Relâche pour actualiser" : "Tire pour actualiser"}</span>}
      </div>
      {children}
    </main>
  );
}

/** Lignes grises affichées pendant un chargement. */
export function Fantomes({ n = 4 }: { n?: number }) {
  return (
    <div aria-busy="true" aria-label="Chargement">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="tx fantome">
          <div className="ic" />
          <div className="mid"><div className="barre" style={{ width: `${62 - (i % 3) * 12}%` }} /><div className="barre fine" style={{ width: `${40 + (i % 2) * 14}%` }} /></div>
          <div className="barre prix" />
        </div>
      ))}
    </div>
  );
}
