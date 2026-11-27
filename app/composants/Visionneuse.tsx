"use client";

import { useRef, useState } from "react";

const MAX = 6;

/**
 * Photo en plein écran : pincer pour zoomer, glisser pour se déplacer, double appui pour zoomer ou revenir.
 */
export default function Visionneuse({ src, fermer, lien }: { src: string; fermer: () => void; lien?: { libelle: string; href: string } | null }) {
  const [vue, setVue] = useState({ e: 1, x: 0, y: 0 }); // échelle et décalage par rapport au centre
  const zone = useRef<HTMLDivElement>(null);
  const doigts = useRef(new Map<number, { x: number; y: number }>());
  const depart = useRef<{ e: number; x: number; y: number; distance: number; cx: number; cy: number } | null>(null);
  const dernierAppui = useRef(0);
  const bouge = useRef(false);

  /** Empêche la photo de sortir de l'écran. */
  function borner(e: number, x: number, y: number) {
    const r = zone.current?.getBoundingClientRect();
    const mx = r ? (r.width * (e - 1)) / 2 : 0;
    const my = r ? (r.height * (e - 1)) / 2 : 0;
    return { e, x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) };
  }

  /** Position d'un point de l'écran par rapport au centre de la zone. */
  function relatif(px: number, py: number) {
    const r = zone.current!.getBoundingClientRect();
    return { x: px - r.left - r.width / 2, y: py - r.top - r.height / 2 };
  }

  function mesure() {
    const p = [...doigts.current.values()];
    if (p.length < 2) return { distance: 0, ...relatif(p[0].x, p[0].y) };
    const c = relatif((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2);
    return { distance: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), ...c };
  }

  function repartir() {
    if (!doigts.current.size) return (depart.current = null);
    const m = mesure();
    depart.current = { ...vue, distance: m.distance, cx: m.x, cy: m.y };
  }

  function appui(ev: React.PointerEvent) {
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    doigts.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    bouge.current = false;
    repartir();
  }

  function deplacement(ev: React.PointerEvent) {
    if (!doigts.current.has(ev.pointerId) || !depart.current) return;
    doigts.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const d = depart.current;
    const m = mesure();
    if (Math.hypot(m.x - d.cx, m.y - d.cy) > 6) bouge.current = true;
    // Pincement : le point entre les deux doigts reste sous les doigts pendant le zoom.
    const e = d.distance && m.distance ? Math.max(1, Math.min(MAX, (d.e * m.distance) / d.distance)) : d.e;
    const k = e / d.e;
    setVue(borner(e, m.x - (d.cx - d.x) * k, m.y - (d.cy - d.y) * k));
  }

  function relache(ev: React.PointerEvent) {
    const unSeul = doigts.current.size === 1;
    doigts.current.delete(ev.pointerId);
    repartir();
    if (!unSeul || bouge.current) return;
    // Double appui : zoom sur le point touché, ou retour à la vue entière.
    const maintenant = Date.now();
    if (maintenant - dernierAppui.current < 320) {
      dernierAppui.current = 0;
      if (vue.e > 1.05) return setVue({ e: 1, x: 0, y: 0 });
      const p = relatif(ev.clientX, ev.clientY);
      setVue(borner(3, -p.x * 2, -p.y * 2));
    } else {
      dernierAppui.current = maintenant;
    }
  }

  return (
    <div className="visionneuse">
      <div
        ref={zone}
        className="zone"
        onPointerDown={appui}
        onPointerMove={deplacement}
        onPointerUp={relache}
        onPointerCancel={relache}
      >
        <img referrerPolicy="no-referrer"
          src={src}
          alt="Photo de la carte de prix, agrandie"
          draggable={false}
          style={{ transform: `translate(${vue.x}px, ${vue.y}px) scale(${vue.e})` }}
        />
      </div>
      <div className="vbarre">
        <span>{vue.e > 1.05 ? `Zoom ${vue.e.toFixed(1).replace(".", ",")} ×` : "Pince pour zoomer, ou touche deux fois"}</span>
        <button onClick={fermer}>Fermer</button>
      </div>
      {lien && <a className="vlien" href={lien.href} target="_blank" rel="noopener noreferrer">{lien.libelle}</a>}
    </div>
  );
}
