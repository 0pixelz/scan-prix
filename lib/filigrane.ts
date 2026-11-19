import type { Filigrane } from "./types";

const LOGO = "/marque/metro.webp";
let logo: Promise<HTMLImageElement | null> | null = null;

function chargerLogo(): Promise<HTMLImageElement | null> {
  logo ??= new Promise((resoudre) => {
    const img = new Image();
    img.onload = () => resoudre(img);
    img.onerror = () => { logo = null; resoudre(null); }; // hors ligne : on réessaiera à la prochaine photo
    img.src = LOGO;
  });
  return logo;
}

/** Lignes de texte de la signature : nom, poste, date et heure de la photo, lieu (facultatif). */
export function lignesFiligrane(f: Filigrane, quand: string, lieu: string | null): string[] {
  const moment = new Date(quand).toLocaleString("fr-CA", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  return [f.nom.trim(), f.poste.trim(), moment, f.lieu ? (lieu ?? "").trim() : ""].filter(Boolean);
}

/**
 * Copie de la photo (2400 px au plus) avec la signature en bas à gauche : logo, nom, poste, heure, lieu.
 * Cette copie est celle qu'on garde et qu'on agrandit ; l'image envoyée en lecture reste intacte.
 */
export async function filigraner(file: File, f: Filigrane, quand: string, lieu: string | null): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const ratio = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * ratio);
    canvas.height = Math.round(img.naturalHeight * ratio);
    const c = canvas.getContext("2d")!;
    c.drawImage(img, 0, 0, canvas.width, canvas.height);

    const lignes = lignesFiligrane(f, quand, lieu);
    const marque = f.logo ? await chargerLogo() : null;
    const t = Math.max(13, Math.round(Math.min(canvas.width, canvas.height) * 0.023)); // taille du texte
    const police = (gras: boolean) => `${gras ? "700" : "500"} ${t}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
    const marge = Math.round(t * 0.9);
    const pad = Math.round(t * 0.7);
    const hLogo = marque ? Math.round(t * 1.7) : 0;
    const lLogo = marque ? Math.round((hLogo * marque.naturalWidth) / marque.naturalHeight) : 0;
    const interligne = Math.round(t * 1.32);
    let largeur = lLogo;
    lignes.forEach((l, i) => { c.font = police(i === 0 && Boolean(f.nom.trim())); largeur = Math.max(largeur, c.measureText(l).width); });
    largeur = Math.min(Math.ceil(largeur), canvas.width - 2 * marge - 2 * pad);
    const hauteur = hLogo + (marque && lignes.length ? Math.round(t * 0.45) : 0) + lignes.length * interligne;
    const x = marge;
    const y = canvas.height - marge - hauteur - 2 * pad;

    c.globalAlpha = Math.min(100, Math.max(20, f.opacite ?? 90)) / 100; // transparence de toute la signature
    c.fillStyle = "#ffffff";
    c.beginPath();
    c.roundRect(x, y, largeur + 2 * pad, hauteur + 2 * pad, Math.round(t * 0.5));
    c.fill();
    let yy = y + pad;
    if (marque) {
      c.drawImage(marque, x + pad, yy, lLogo, hLogo);
      yy += hLogo + (lignes.length ? Math.round(t * 0.45) : 0);
    }
    c.fillStyle = "#111827";
    c.textBaseline = "top";
    lignes.forEach((l, i) => {
      c.font = police(i === 0 && Boolean(f.nom.trim()));
      c.fillText(l, x + pad, yy + Math.round((interligne - t) / 2), largeur);
      yy += interligne;
    });
    c.globalAlpha = 1;
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}
