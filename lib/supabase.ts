import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const configOk = Boolean(url && anon);

// Jeton de session obtenu en échange du code à 4 chiffres ; gardé sur l'appareil.
const CLE_JETON = "scanprix.jeton";
let jetonMemoire: string | null = null;

export function lireJeton(): string | null {
  if (jetonMemoire) return jetonMemoire;
  try {
    jetonMemoire = localStorage.getItem(CLE_JETON);
  } catch {
    /* stockage indisponible : le jeton reste en mémoire */
  }
  return jetonMemoire;
}

export function ecrireJeton(jeton: string | null) {
  jetonMemoire = jeton;
  try {
    if (jeton) localStorage.setItem(CLE_JETON, jeton);
    else localStorage.removeItem(CLE_JETON);
  } catch {
    /* stockage indisponible */
  }
}

// Clé de l'appareil : désigne l'espace privé de ce téléphone quand on entre avec le code collègue.
// Créée une fois, gardée sur l'appareil, envoyée seulement à l'ouverture de session.
const CLE_APPAREIL = "scanprix.appareil";
export function cleAppareil(): string | null {
  try {
    let cle = localStorage.getItem(CLE_APPAREIL);
    if (!cle || cle.length < 32) {
      const octets = crypto.getRandomValues(new Uint8Array(24));
      cle = Array.from(octets, (o) => o.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(CLE_APPAREIL, cle);
    }
    return cle;
  } catch {
    return null; // stockage indisponible : pas d'espace privé possible
  }
}

/** Jeton d'un lien d'invitation (« …/#inv=… »), ou d'un jeton collé seul. */
export function jetonInvitation(texte: string): string | null {
  const m = texte.match(/inv=([a-f0-9]{48})/i) ?? texte.trim().match(/^([a-f0-9]{48})$/i);
  return m ? m[1].toLowerCase() : null;
}

/** Ouvre une session à partir d'un lien d'invitation : accès complet, dans l'espace privé de ce téléphone. */
export async function ouvrirInvitation(texte: string): Promise<"ok" | "invalide" | "bloque" | "reseau"> {
  const invitation = jetonInvitation(texte);
  if (!invitation) return "invalide";
  const { data, error } = await supabaseBrowser().rpc("ouvrir_invitation", { invitation, appareil: cleAppareil() });
  if (error) return "reseau";
  if (data?.ok && data.jeton) {
    ecrireJeton(data.jeton);
    try { localStorage.setItem(CLE_INVITATION, invitation); } catch { /* stockage indisponible */ }
    return "ok";
  }
  return data?.bloque ? "bloque" : "invalide";
}

// Invitation avec laquelle ce téléphone est entré : gardée pour que l'app ajoutée à l'écran d'accueil s'ouvre sans code.
const CLE_INVITATION = "scanprix.invitation";

/** Clé d'appareil transmise par l'adresse (« …&app=… ») : l'app de l'écran d'accueil reprend l'espace déjà utilisé dans le navigateur. */
export function adopterAppareil(texte: string) {
  const m = texte.match(/app=([a-f0-9]{48})/i);
  if (!m) return;
  try {
    if (!localStorage.getItem(CLE_APPAREIL)) localStorage.setItem(CLE_APPAREIL, m[1].toLowerCase());
  } catch {
    /* stockage indisponible */
  }
}

/**
 * Pour un téléphone entré par invitation : l'adresse et le manifeste de l'app portent l'invitation et la clé
 * d'appareil (après le « # », donc jamais envoyées au serveur). Ainsi, « Sur l'écran d'accueil » installe une app
 * qui s'ouvre sans code, dans le même espace privé.
 */
export function preparerInstallation() {
  try {
    const invitation = localStorage.getItem(CLE_INVITATION);
    const appareil = cleAppareil();
    if (!invitation || !appareil) return;
    const depart = `${window.location.origin}/#inv=${invitation}&app=${appareil}`;
    if (window.location.href !== depart) history.replaceState(null, "", depart);
    const manifeste = {
      name: "Scan Prix", short_name: "Scan Prix", start_url: depart, scope: `${window.location.origin}/`, display: "standalone",
      background_color: "#f1f5f9", theme_color: "#0f172a", lang: "fr-CA",
      icons: [192, 512].map((t) => ({ src: `${window.location.origin}/icon-${t}.png`, sizes: `${t}x${t}`, type: "image/png" })),
    };
    let lien = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!lien) {
      lien = document.createElement("link");
      lien.rel = "manifest";
      document.head.appendChild(lien);
    }
    lien.href = `data:application/manifest+json,${encodeURIComponent(JSON.stringify(manifeste))}`;
  } catch {
    /* sans stockage : l'app reste utilisable, sans installation préparée */
  }
}

/** Oublie l'invitation de ce téléphone (accès retiré). */
export function oublierInvitation() {
  try { localStorage.removeItem(CLE_INVITATION); } catch { /* stockage indisponible */ }
}

let browserClient: SupabaseClient | null = null;

/** Client navigateur : chaque requête porte le jeton de session dans l'en-tête x-jeton. */
export function supabaseBrowser(): SupabaseClient {
  if (!browserClient) {
    browserClient = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const headers = new Headers(init?.headers);
          const jeton = lireJeton();
          if (jeton) headers.set("x-jeton", jeton);
          return fetch(input, { ...init, headers });
        },
      },
    });
  }
  return browserClient;
}

/** Client serveur agissant avec le jeton de session reçu du navigateur. */
export function supabaseServer(jeton: string): SupabaseClient | null {
  if (!configOk) return null;
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-jeton": jeton } },
  });
}
