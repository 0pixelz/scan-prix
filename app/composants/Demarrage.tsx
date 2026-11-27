import { LOGOS_BANNIERES } from "@/lib/bannieres";

/** Écran d'ouverture : un code-barres balayé par une ligne de lecture, le temps que l'app se prépare. */
const BARRES = [3, 1, 2, 1, 1, 3, 1, 2, 2, 1, 3, 1, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1, 1, 3, 1, 2];

export default function Demarrage() {
  return (
    <div className="app demarrage" role="status" aria-label="Chargement de Scan Prix">
      <div className="codebarres" aria-hidden="true">
        <div className="barres">
          {BARRES.map((l, i) => <i key={i} style={{ flexGrow: l }} />)}
        </div>
        <span className="laser" />
      </div>
      <h1>Scan Prix</h1>
      <div className="muted">Chargement…</div>
      <div className="logos-rebond" aria-hidden="true">
        {LOGOS_BANNIERES.filter((l) => l !== "reebee").map((l, i) => (
          <img key={l} src={`/bannieres/${l}.webp`} alt="" style={{ animationDelay: `${i * 0.11}s` }} />
        ))}
      </div>
    </div>
  );
}
