export type Apparence = { theme: "auto" | "clair" | "sombre"; texte: "normal" | "grand" | "tresgrand" };

export const APPARENCE_DEFAUT: Apparence = { theme: "auto", texte: "normal" };
const CLE = "scanprix.apparence";
const SOMBRE = "(prefers-color-scheme: dark)";

/** Apparence choisie sur cet appareil (le thème et la taille du texte ne suivent pas le compte). */
export function lireApparence(): Apparence {
  try {
    const a = JSON.parse(localStorage.getItem(CLE) ?? "{}") as Partial<Apparence>;
    return {
      theme: a.theme === "clair" || a.theme === "sombre" ? a.theme : "auto",
      texte: a.texte === "grand" || a.texte === "tresgrand" ? a.texte : "normal",
    };
  } catch {
    return APPARENCE_DEFAUT;
  }
}

// Règles « thème sombre » de la feuille de style, retrouvées une fois puis réorientées selon le choix.
let regles: CSSMediaRule[] | null = null;

function reglesSombres(): CSSMediaRule[] {
  if (regles?.length) return regles;
  const trouvees: CSSMediaRule[] = [];
  for (const feuille of Array.from(document.styleSheets)) {
    try {
      for (const r of Array.from(feuille.cssRules)) {
        if (r instanceof CSSMediaRule && r.conditionText.includes("prefers-color-scheme: dark")) trouvees.push(r);
      }
    } catch { /* feuille d'une autre origine : ignorée */ }
  }
  regles = trouvees;
  return trouvees;
}

/** Applique le thème (auto, clair, sombre) et la taille du texte, et les garde pour la prochaine ouverture. */
export function appliquerApparence(a: Apparence, garder = true) {
  const media = a.theme === "sombre" ? "all" : a.theme === "clair" ? "not all" : SOMBRE;
  for (const r of reglesSombres()) r.media.mediaText = media;
  const racine = document.documentElement;
  racine.style.colorScheme = a.theme === "sombre" ? "dark" : a.theme === "clair" ? "light" : "light dark";
  racine.dataset.texte = a.texte;
  const sombre = a.theme === "sombre" || (a.theme === "auto" && window.matchMedia(SOMBRE).matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", sombre ? "#0b1220" : "#f3f5f9"));
  if (garder) try { localStorage.setItem(CLE, JSON.stringify(a)); } catch { /* stockage indisponible */ }
}
