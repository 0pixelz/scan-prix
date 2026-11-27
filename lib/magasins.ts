import { distanceMetres } from "./comparaison";

export type MagasinProche = { nom: string; distance: number; latitude: number; longitude: number }; // distance en mètres

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
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(banniere)}&viewbox=${zone}&bounded=1&limit=40&addressdetails=1&extratags=1&accept-language=fr&countrycodes=ca`;
  const rep = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!rep.ok) return [];
  const lieux = (await rep.json()) as { name?: string; category?: string; lat: string; lon: string; address?: Record<string, string>; extratags?: Record<string, string> | null }[];
  const vus = new Set<string>();
  return lieux
    // Seulement des commerces (ou pharmacies) qui portent le nom de la bannière : pas de station de métro ni d'entrepôt.
    .filter((l) => (l.category === "shop" || l.category === "amenity") && simple(l.name ?? "").includes(cle))
    .map((l) => {
      const a = l.address ?? {};
      const ville = a.city ?? a.town ?? a.village ?? a.municipality ?? a.suburb ?? "";
      // Nom propre du magasin quand la carte le donne (« Metro Plus Dépatie », « Metro Famille Thibault ») : le nom
      // inscrit s'il dit plus que la bannière, sinon l'exploitant (le marchand propriétaire) ou le nom officiel.
      // À défaut, la rue.
      const e = l.extratags ?? {};
      const generique = (t: string) => ["", "plus", "marche", "supermarche", "pharmacie"].includes(simple(t).replace(cle, ""));
      const societe = (t: string) => /\b(inc|ltee|ltd|limited|corporation|corp|loblaws?|sobeys|walmart|costco)\b/i.test(t.normalize("NFD").replace(/[^a-zA-Z ]/g, " "));
      const inscrit = (l.name ?? "").trim();
      const exploitant = (e.operator ?? "").trim();
      const brut = !generique(inscrit) ? inscrit
        : exploitant && !generique(exploitant) && !societe(exploitant) ? (simple(exploitant).includes(cle) ? exploitant : `${inscrit} ${exploitant}`)
        : [e.official_name, e.alt_name, e.short_name].find((x) => x && simple(x).includes(cle) && !generique(x)) ?? "";
      // « Metro famille Thibeault Mirabel » : la ville est déjà devant, on ne la répète pas.
      const propre = ville && simple(brut).endsWith(simple(ville)) ? brut.slice(0, brut.length - ville.length).trim() : brut;
      // Sans nom propre (ex. Dollarama, dont les magasins n'en ont pas) : le secteur de la ville, puis le centre
      // commercial s'il y en a un, sinon l'adresse.
      const secteur = [a.suburb, a.neighbourhood, a.quarter].find((x) => x && x !== ville && !/^district\b/i.test(x)) ?? "";
      const centre = a.retail ?? a.mall ?? a.commercial ?? "";
      const adresse = [a.house_number, a.road].filter(Boolean).join(" ");
      const lieu = propre || [secteur, centre || adresse].filter(Boolean).join(" · ");
      const nom = [ville, lieu].filter(Boolean).join(" · ");
      const latitude = Number(l.lat), longitude = Number(l.lon);
      return { nom, latitude, longitude, distance: distanceMetres(ici, { latitude, longitude }) };
    })
    .filter((m) => m.nom && Number.isFinite(m.distance))
    .sort((a, b) => a.distance - b.distance)
    .filter((m) => (vus.has(m.nom) ? false : (vus.add(m.nom), true)))
    .slice(0, 3);
}

export const distanceLisible = (m: number) => (m < 950 ? `${Math.round(m / 50) * 50} m` : `${(m / 1000).toLocaleString("fr-CA", { maximumFractionDigits: 1 })} km`);

/** Itinéraire vers un magasin : dans Plans (Apple) ou dans Google Maps. */
export function itineraires(m: { latitude: number; longitude: number }, banniere: string): { plans: string; google: string } {
  const point = `${m.latitude.toFixed(6)},${m.longitude.toFixed(6)}`;
  return {
    plans: `https://maps.apple.com/?daddr=${point}&q=${encodeURIComponent(banniere)}&dirflg=d`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${point}&travelmode=driving`,
  };
}
