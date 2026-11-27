// Bannières dont on a le logo (fichiers fournis dans public/bannieres).
export const LOGOS_BANNIERES = ["iga", "walmart", "costco", "maxi", "dollarama", "provigo", "metro", "superc", "pharmaprix", "adonis", "jeancoutu", "tigregeant"];

/** Adresse du logo d'une bannière, ou null si on n'en a pas. */
export function logoBanniere(banniere: string | null | undefined): string | null {
  const cle = (banniere ?? "").toLowerCase().normalize("NFD").replace(/[^a-z]/g, "").replace(/^marche(?=adonis$)/, "").replace(/^gianttiger$/, "tigregeant"); // « Marché Adonis » = Adonis, « Giant Tiger » = Tigre Géant
  return LOGOS_BANNIERES.includes(cle) ? `/bannieres/${cle}.webp` : null;
}
