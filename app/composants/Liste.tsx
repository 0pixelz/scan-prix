"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { correspond } from "@/lib/comparaison";
import type { ProduitListe, Scan, Visite } from "@/lib/types";
import { ScannerCode } from "./Fenetres";
import { ICoche, ICodeBarres, IFermer, IListe, IPlus } from "./ui";

/** Liste des produits à relever : coche automatique quand le produit est scanné dans la visite en cours. */
export default function Liste({ liste, scans, visite, recharger }: {
  liste: ProduitListe[];
  scans: Scan[];
  visite: Visite | null;
  recharger: () => void;
}) {
  const sb = supabaseBrowser();
  const [nom, setNom] = useState("");
  const [cup, setCup] = useState("");
  const [lecteur, setLecteur] = useState(false);
  const [erreur, setErreur] = useState("");

  const releves = new Set(liste.filter((p) => scans.some((s) => correspond(p, s))).map((p) => p.id));
  const tries = [...liste].sort((a, b) => Number(releves.has(a.id)) - Number(releves.has(b.id)));

  async function ajouter(e: React.FormEvent) {
    e.preventDefault();
    if (!nom.trim()) return;
    const { error } = await sb.from("liste_produits").insert({ nom: nom.trim(), cup: cup.replace(/\D/g, "") || null });
    if (error) return setErreur(error.message);
    setNom("");
    setCup("");
    recharger();
  }

  async function retirer(id: string) {
    const { error } = await sb.from("liste_produits").delete().eq("id", id);
    if (error) setErreur(error.message);
    else recharger();
  }

  if (lecteur) return <ScannerCode fermer={() => setLecteur(false)} lu={(code) => { setCup(code); setLecteur(false); }} />;

  return (
    <main>
      {erreur && <div className="alert" onClick={() => setErreur("")}>{erreur}</div>}

      <form className="card" onSubmit={ajouter}>
        <h2>Ajouter un produit à relever</h2>
        <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Ex. Beurre salé 454 g" />
        <div className="row" style={{ marginTop: 8 }}>
          <input className="grow" value={cup} inputMode="numeric" onChange={(e) => setCup(e.target.value)} placeholder="CUP (facultatif)" />
          <button type="button" aria-label="Scanner le code-barres" onClick={() => setLecteur(true)}><ICodeBarres /></button>
          <button className="primary" disabled={!nom.trim()}><IPlus /> Ajouter</button>
        </div>
      </form>

      <div className="card">
        <div className="row between" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>À relever</h2>
          {liste.length > 0 && <span className="muted">{releves.size} sur {liste.length} relevés{visite ? ` · ${visite.banniere}` : ""}</span>}
        </div>
        {liste.length > 0 && <div className="bar"><i style={{ width: `${(releves.size / liste.length) * 100}%` }} /></div>}
        {!liste.length && (
          <div className="empty">
            <IListe />
            <div>Ta liste est vide.</div>
            <div className="muted">Ajoute les produits à trouver en magasin : ils se cochent tout seuls quand tu les scannes.</div>
          </div>
        )}
        {tries.map((p) => (
          <div key={p.id} className={`tx ${releves.has(p.id) ? "fait" : ""}`} style={{ cursor: "default" }}>
            <div className={`coche ${releves.has(p.id) ? "on" : ""}`}>{releves.has(p.id) && <ICoche />}</div>
            <div className="mid">
              <div className="t">{p.nom}</div>
              {p.cup && <div className="s">CUP {p.cup}</div>}
            </div>
            <button className="ghost icone" aria-label={`Retirer ${p.nom}`} onClick={() => retirer(p.id)}><IFermer /></button>
          </div>
        ))}
      </div>
    </main>
  );
}
