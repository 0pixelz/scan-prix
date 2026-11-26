"use client";

import { useState } from "react";
import { cleAppareil, ecrireJeton, supabaseBrowser } from "@/lib/supabase";
import { IEffacer } from "./ui";

/** Écran du code à 4 chiffres. Le code est vérifié par le serveur, qui remet un jeton gardé sur l'appareil. */
export default function Code({ ouvert }: { ouvert: () => void }) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [attente, setAttente] = useState(false);

  async function verifier(c: string) {
    setAttente(true);
    setMessage("");
    const { data, error } = await supabaseBrowser().rpc("ouvrir_session_appareil", { code: c, appareil: cleAppareil() });
    setAttente(false);
    if (error) return (setCode(""), setMessage("Connexion impossible. Vérifie ton réseau et réessaie."));
    if (data?.ok && data.jeton) {
      ecrireJeton(data.jeton);
      return ouvert();
    }
    setCode("");
    setMessage(data?.bloque ? "Trop d'essais. Réessaie dans 15 minutes." : "Code incorrect.");
  }

  function touche(chiffre: string) {
    if (attente || code.length >= 4) return;
    const c = code + chiffre;
    setCode(c);
    if (c.length === 4) verifier(c);
  }

  return (
    <div className="app code">
      <div className="codebox">
        <h1>Scan Prix</h1>
        <div className="muted">Entre ton code à 4 chiffres</div>
        <div className="points" aria-label={`${code.length} chiffres entrés sur 4`}>
          {[0, 1, 2, 3].map((i) => <span key={i} className={i < code.length ? "plein" : ""} />)}
        </div>
        <div className="codemsg" role="status">{attente ? "Vérification…" : message}</div>
        <div className="clavier">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((c) => (
            <button key={c} onClick={() => touche(c)} disabled={attente}>{c}</button>
          ))}
          <span />
          <button onClick={() => touche("0")} disabled={attente}>0</button>
          <button className="ghost" aria-label="Effacer" onClick={() => setCode(code.slice(0, -1))} disabled={attente || !code}><IEffacer /></button>
        </div>
      </div>
    </div>
  );
}
