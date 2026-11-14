"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import type { Visite } from "@/lib/types";
import { IAssistant, ICamera, IEnvoyer, IFermer, reduire } from "./ui";

const SUGGESTIONS = [
  "Résume cette visite",
  "Quels produits sont en promotion ?",
  "Que reste-t-il à relever ?",
  "Compare avec mes autres visites",
];

type Message = { role: "user" | "assistant"; content: string; image?: string };

export default function Assistant({ visite, modifie, refuse }: { visite: Visite | null; modifie: () => void; refuse: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [texte, setTexte] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [attente, setAttente] = useState(false);
  const fin = useRef<HTMLDivElement>(null);

  useEffect(() => { fin.current?.scrollIntoView({ block: "end" }); }, [messages, attente, photo]);

  async function joindre(files: FileList | null) {
    if (!files?.length) return;
    try { setPhoto(await reduire(files[0])); } catch { /* photo illisible : on ignore */ }
  }

  async function envoyer(contenu: string) {
    const image = photo;
    const question = contenu.trim() || (image ? "Lis cette carte de prix et ajoute les informations à la visite en cours." : "");
    if (!question || attente) return;
    const suite: Message[] = [...messages, { role: "user", content: question, ...(image ? { image } : {}) }];
    setMessages(suite);
    setTexte("");
    setPhoto(null);
    setAttente(true);
    try {
      const { data: json, error } = await supabaseBrowser().functions.invoke("assistant", {
        body: {
          // Les photos des messages précédents ne sont pas renvoyées : seule la nouvelle l'est.
          messages: suite.map((m) => ({ role: m.role, content: m.image ? `[Photo jointe] ${m.content}` : m.content })),
          visiteId: visite?.id,
          image: image ?? undefined,
        },
      });
      if (error) throw new Error("Assistant indisponible. Réessaie dans un instant.");
      if (json.acces === false) return refuse();
      if (json.error) throw new Error(json.error);
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
            <div className="muted">Pose une question sur tes prix, ou envoie la photo d'une carte de prix.</div>
            <div className="herogrid">
              {SUGGESTIONS.map((s) => <button key={s} onClick={() => envoyer(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bub ${m.role === "user" ? "me" : "ai"}`}>
            {m.image && <img src={m.image} alt="Photo jointe" />}
            {m.content}
          </div>
        ))}
        {attente && <div className="bub typing">Claude réfléchit…</div>}
        <div ref={fin} />
      </div>
      <div className="chatfoot">
        {photo && (
          <div className="apercu">
            <img src={photo} alt="Photo à envoyer" />
            <button type="button" aria-label="Retirer la photo" onClick={() => setPhoto(null)}><IFermer /></button>
          </div>
        )}
        <form className="chatbar" onSubmit={(e) => { e.preventDefault(); envoyer(texte); }}>
          <label className="joindre" aria-label="Joindre une photo">
            <ICamera />
            <input type="file" accept="image/*" onChange={(e) => { joindre(e.target.files); e.target.value = ""; }} />
          </label>
          <textarea
            rows={1}
            value={texte}
            placeholder={photo ? "Ajoute une consigne (facultatif)…" : "Écris ta question…"}
            onChange={(e) => setTexte(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); envoyer(texte); } }}
          />
          <button aria-label="Envoyer" disabled={attente || (!texte.trim() && !photo)}><IEnvoyer /></button>
        </form>
        <div className="pbc">Propulsé par Claude</div>
      </div>
    </main>
  );
}
