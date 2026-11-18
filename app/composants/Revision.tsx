"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import type { Scan } from "@/lib/types";
import Visionneuse from "./Visionneuse";

const CHAMPS: [string, string, "decimal" | "numeric" | "text"][] = [
  ["produit", "Produit", "text"],
  ["format", "Format", "text"],
  ["prix_regulier", "Prix régulier ($)", "decimal"],
  ["prix_promo", "Prix promo ($)", "decimal"],
  ["promo_quantite", "Quantité promo", "numeric"],
  ["cup", "CUP", "numeric"],
];

/** Révision rapide : les prix « à vérifier » défilent un par un, photo en haut et champs essentiels en dessous. */
export default function Revision({ scans, fermer, modifie }: {
  scans: Scan[];
  fermer: () => void;
  modifie: (s: Scan) => void;
}) {
  const sb = supabaseBrowser();
  const [liste] = useState(scans); // figée à l'ouverture : la liste ne bouge pas pendant qu'on la parcourt
  const [index, setIndex] = useState(0);
  const [f, setF] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState<string | null>(null);
  const [agrandie, setAgrandie] = useState(false);
  const [erreur, setErreur] = useState("");
  const [faits, setFaits] = useState(0);
  const scan = liste[index];

  useEffect(() => {
    if (!scan) return;
    setF(Object.fromEntries(CHAMPS.map(([k]) => [k, (scan as Record<string, unknown>)[k]?.toString() ?? ""])));
    setPhoto(null);
    setErreur("");
    if (!scan.photo_path) return;
    let annule = false;
    sb.functions.invoke("photo", { body: { path: scan.photo_path, grande: true } }).then(({ data }) => { if (!annule) setPhoto(data?.url ?? null); });
    return () => { annule = true; };
  }, [sb, scan]);

  if (!scan) {
    return (
      <div className="sheet">
        <div className="panel">
          <div className="grip" />
          <h3>Révision terminée</h3>
          <p className="muted">{faits} prix vérifié{faits > 1 ? "s" : ""} sur {liste.length}.</p>
          <div className="actions"><button className="primary full" onClick={fermer}>Fermer</button></div>
        </div>
      </div>
    );
  }

  const change = CHAMPS.some(([k]) => f[k] !== ((scan as Record<string, unknown>)[k]?.toString() ?? ""));

  async function valider() {
    const t = (k: string) => (f[k] ?? "").trim() || null;
    const n = (k: string) => {
      const v = parseFloat((f[k] ?? "").replace(",", "."));
      return Number.isFinite(v) ? v : null;
    };
    const qte = n("promo_quantite");
    const maj = change
      ? { produit: t("produit"), format: t("format"), prix_regulier: n("prix_regulier"), prix_promo: n("prix_promo"), promo_quantite: qte === null ? null : Math.trunc(qte), cup: t("cup")?.replace(/\D/g, "") || null, confiance: "haute" }
      : { confiance: "haute" };
    const { data, error } = await sb.from("scans").update(maj).eq("id", scan.id).select().single();
    if (error) return setErreur(error.message);
    modifie(data as Scan);
    setFaits((x) => x + 1);
    setIndex((i) => i + 1);
  }

  if (agrandie && photo) return <Visionneuse src={photo} fermer={() => setAgrandie(false)} />;

  return (
    <div className="sheet">
      <div className="panel revision">
        <div className="grip" />
        <div className="row between">
          <h3>À vérifier · {index + 1} sur {liste.length}</h3>
          <button type="button" className="ghost" onClick={fermer}>Fermer</button>
        </div>
        <div className="bar" style={{ marginTop: 10 }}><i style={{ width: `${(index / liste.length) * 100}%` }} /></div>
        {photo ? (
          <button type="button" className="photo" onClick={() => setAgrandie(true)} aria-label="Agrandir la photo">
            <img src={photo} alt="Photo de la carte de prix" />
            <span>Toucher pour agrandir</span>
          </button>
        ) : (
          <div className="muted" style={{ margin: "12px 0" }}>{scan.photo_path ? "Chargement de la photo…" : "Aucune photo pour ce prix."}</div>
        )}
        <div className="grid2">
          {CHAMPS.map(([k, libelle, mode]) => (
            <div key={k} style={k === "produit" ? { gridColumn: "1 / -1" } : undefined}>
              <label>{libelle}</label>
              <input value={f[k] ?? ""} inputMode={mode} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
            </div>
          ))}
        </div>
        {erreur && <div className="alert" style={{ marginTop: 12 }}>{erreur}</div>}
        <div className="actions">
          <button className="primary full" onClick={valider}>{change ? "Enregistrer la correction" : "C'est correct"}</button>
          <button className="full" onClick={() => setIndex((i) => i + 1)}>Passer</button>
        </div>
      </div>
    </div>
  );
}
