import { distanceMetres } from "./comparaison";

export type MagasinProche = { nom: string; distance: number }; // distance en mètres

const simple = (t: string) => t.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");

/**
 * Magasins d'une bannière autour d'une position, du plus proche au plus loin, d'après OpenStreetMap (Nominatim).
 * La position exacte ne quitte pas l'appareil : la recherche porte sur une zone d'environ 35 km centrée sur un
 * point arrondi, et la distance est calculée ici.
 */
export async function magasinsProches(banniere: string, ici: { latitude: number; longitude: number }): Promise<MagasinProche[]> {
  const cle = simple(banniere);
  if (cle.length < 2) return [];
  const lat = Math.round(ici.latitude * 20) / 20;
  const lon = Math.round(ici.longitude * 20) / 20;
  const zone = [lon - 0.25, lat + 0.17, lon + 0.25, lat - 0.17].map((v) => v.toFixed(2)).join(",");
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(banniere)}&viewbox=${zone}&bounded=1&limit=40&addressdetails=1&accept-language=fr&countrycodes=ca`;
  const rep = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!rep.ok) return [];
  const lieux = (await rep.json()) as { name?: string; category?: string; lat: string; lon: string; address?: Record<string, string> }[];
  const vus = new Set<string>();
  return lieux
    // Seulement des commerces (ou pharmacies) dont le nom commence par la bannière : pas de station de métro ni d'entrepôt.
    .filter((l) => (l.category === "shop" || l.category === "amenity") && simple(l.name ?? "").startsWith(cle))
    .map((l) => {
      const a = l.address ?? {};
      const ville = a.city ?? a.town ?? a.village ?? a.municipality ?? a.suburb ?? "";
      const nom = [ville, a.road].filter(Boolean).join(" · ");
      return { nom, distance: distanceMetres(ici, { latitude: Number(l.lat), longitude: Number(l.lon) }) };
    })
    .filter((m) => m.nom && Number.isFinite(m.distance))
    .sort((a, b) => a.distance - b.distance)
    .filter((m) => (vus.has(m.nom) ? false : (vus.add(m.nom), true)))
    .slice(0, 3);
}

export const distanceLisible = (m: number) => (m < 950 ? `${Math.round(m / 50) * 50} m` : `${(m / 1000).toLocaleString("fr-CA", { maximumFractionDigits: 1 })} km`);
