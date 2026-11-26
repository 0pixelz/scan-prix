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
