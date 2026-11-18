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

export type Bande = { largeur: number; hauteur: number; cx: number; cy: number; aretes: number };

/**
 * Cherche une carte de prix plus petite que le cadre (on est trop loin) : la plus grande tache claire,
 * à peu près rectangulaire, avec du texte dedans. Renvoie sa taille et son centre en fraction du cadre.
 */
export function bandeCarte(g: Uint8Array, w = LARGEUR, h = HAUTEUR): Bande | null {
  const n = w * h;
  const histo = new Uint32Array(256);
  for (let i = 0; i < n; i++) histo[g[i]]++;
  let cumul = 0;
  let clair = 255;
  for (let v = 255; v >= 0; v--) {
    cumul += histo[v];
    if (cumul >= n * 0.03) {
      clair = v;
      break;
    }
  }
  if (clair < 120) return null;
  const seuil = clair * 0.72;

  // Plus grande tache de pixels clairs qui se touchent (le fond de la carte entoure le texte).
  const vu = new Uint8Array(n);
  const pile = new Int32Array(n);
  let meilleure: { aire: number; x0: number; x1: number; y0: number; y1: number } | null = null;
  for (let depart = 0; depart < n; depart++) {
    if (vu[depart] || g[depart] < seuil) continue;
    let sommet = 0;
    pile[sommet++] = depart;
    vu[depart] = 1;
    let aire = 0;
    let x0 = w, x1 = 0, y0 = h, y1 = 0;
    while (sommet) {
      const i = pile[--sommet];
      const x = i % w;
      const y = (i - x) / w;
      aire++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const voisins = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const v of voisins) {
        if (v >= 0 && !vu[v] && g[v] >= seuil) {
          vu[v] = 1;
          pile[sommet++] = v;
        }
      }
    }
    if (!meilleure || aire > meilleure.aire) meilleure = { aire, x0, x1, y0, y1 };
  }
  if (!meilleure) return null;
  const bw = meilleure.x1 - meilleure.x0 + 1;
  const bh = meilleure.y1 - meilleure.y0 + 1;
  // Trop petite, ou pas assez pleine pour être un rectangle (reflet, forme allongée en diagonale…)
  if (meilleure.aire < n * 0.015 || bh < 4 || bw < 6 || meilleure.aire / (bw * bh) < 0.45) return null;

  let aretes = 0;
  let total = 0;
  for (let y = Math.max(1, meilleure.y0); y <= Math.min(h - 2, meilleure.y1); y++) {
    for (let x = Math.max(1, meilleure.x0); x <= Math.min(w - 2, meilleure.x1); x++) {
      const i = y * w + x;
      total++;
      if (Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + w] - g[i - w]) > 60) aretes++;
    }
  }
  return {
    largeur: bw / w,
    hauteur: bh / h,
    cx: (meilleure.x0 + bw / 2) / w,
    cy: (meilleure.y0 + bh / 2) / h,
    aretes: total ? aretes / total : 0,
  };
}

/** Facteur de zoom pour que la carte trouvée remplisse le cadre (1 = ne pas zoomer). */
export function zoomPour(b: Bande): number {
  // Carte petite, au centre, avec du texte. Une bande claire sur toute la largeur (plusieurs cartes côte à côte)
  // est jugée sur sa hauteur seulement.
  if (b.aretes < 0.04 || Math.abs(b.cx - 0.5) > 0.22 || Math.abs(b.cy - 0.5) > 0.22) return 1;
  if (b.hauteur >= 0.6 || (b.largeur >= 0.7 && b.largeur <= 0.8)) return 1;
  const parHauteur = 0.85 / b.hauteur;
  const facteur = b.largeur > 0.8 ? parHauteur : Math.min(parHauteur, 0.9 / b.largeur);
  return facteur < 1.25 ? 1 : Math.min(2.2, facteur);
}
