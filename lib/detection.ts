/**
 * Détection approximative d'une carte de prix dans le cadre de la caméra, sans IA :
 * une carte est une surface claire, contrastée et pleine de petits détails (du texte).
 * C'est un indice pour déclencher la photo, pas une lecture : Claude fait la lecture ensuite.
 */

export const LARGEUR = 96;
export const HAUTEUR = 64;

/** Convertit les pixels RGBA d'un échantillon en niveaux de gris. */
export function enGris(rgba: Uint8ClampedArray): Uint8Array {
  const gris = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    gris[j] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
  }
  return gris;
}

export type Mesure = { clair: number; fond: number; aretes: number; contraste: number; carte: boolean };

/** Mesure un échantillon LARGEUR x HAUTEUR en niveaux de gris. */
export function analyser(g: Uint8Array, w = LARGEUR, h = HAUTEUR): Mesure {
  const n = w * h;
  const histo = new Uint32Array(256);
  let somme = 0;
  for (let i = 0; i < n; i++) {
    histo[g[i]]++;
    somme += g[i];
  }
  const moyenne = somme / n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (g[i] - moyenne) ** 2;
  const contraste = Math.sqrt(variance / n);

  // « clair » : niveau du fond de la carte (90e centile de luminosité)
  let cumul = 0;
  let clair = 255;
  for (let v = 255; v >= 0; v--) {
    cumul += histo[v];
    if (cumul >= n * 0.1) {
      clair = v;
      break;
    }
  }
  // Part de l'image occupée par ce fond clair
  let fondPixels = 0;
  for (let i = 0; i < n; i++) if (g[i] >= clair * 0.72) fondPixels++;
  const fond = fondPixels / n;

  // Part de pixels situés sur une arête nette (bords de lettres, de chiffres)
  let aretesPixels = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + w] - g[i - w]) > 60) aretesPixels++;
    }
  }
  const aretes = aretesPixels / ((w - 2) * (h - 2));

  const carte = clair >= 120 && fond >= 0.45 && contraste >= 28 && aretes >= 0.05 && aretes <= 0.6;
  return { clair, fond, aretes, contraste, carte };
}

/** Réduit l'échantillon à une grille grossière (24 x 16), peu sensible aux petits tremblements. */
export function grossier(g: Uint8Array, w = LARGEUR, h = HAUTEUR): Float32Array {
  const pas = 4;
  const gw = w / pas;
  const gh = h / pas;
  const r = new Float32Array(gw * gh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) r[Math.floor(y / pas) * gw + Math.floor(x / pas)] += g[y * w + x];
  }
  for (let i = 0; i < r.length; i++) r[i] /= pas * pas;
  return r;
}

/** Écart moyen entre deux grilles : faible si la caméra est immobile, fort si elle se déplace. */
export function ecart(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

export const SEUIL_IMMOBILE = 4; // en dessous : la caméra ne bouge pas
export const SEUIL_DEPLACEMENT = 10; // au-dessus : la caméra s'est déplacée vers autre chose
export const IMAGES_STABLES = 5; // nombre de mesures immobiles avant de déclencher (environ 0,8 s)
