import type { SupabaseClient } from "@supabase/supabase-js";
import { cupNormalise } from "@/lib/comparaison";
import type { Reference, ScanAvecVisite } from "@/lib/types";
import { logoBanniere } from "@/lib/bannieres";

export const BANNIERES = ["IGA", "Walmart", "Costco", "Maxi", "Dollarama", "Provigo", "Metro", "Super C", "Pharmaprix", "Adonis"];

export { logoBanniere };

/** Pastille d'une bannière : son logo s'il est connu, sinon son initiale. */
export function PastilleBanniere({ banniere, doux }: { banniere: string | null | undefined; doux?: boolean }) {
  const logo = logoBanniere(banniere);
  if (logo) return <div className="ic logo"><img src={logo} alt="" /></div>;
  return <div className={`ic ${doux ? "soft" : ""}`}>{(banniere || "?").trim().charAt(0).toUpperCase()}</div>;
}

export const argent = (v: number | null) =>
  v === null ? "—" : Number(v).toLocaleString("fr-CA", { style: "currency", currency: "CAD" });

export const aujourdhui = () => new Date().toLocaleDateString("en-CA"); // AAAA-MM-JJ, heure locale

export const dateLisible = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("fr-CA", {
    day: "numeric",
    month: "short",
    ...(d.slice(0, 4) === String(new Date().getFullYear()) ? {} : { year: "numeric" }), // année seulement si ce n'est pas l'année en cours
  });

/** Date et heure courtes : « 14 nov., 18 h 01 ». */
export const momentLisible = (iso: string) =>
  new Date(iso).toLocaleString("fr-CA", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    ...(iso.slice(0, 4) === String(new Date().getFullYear()) ? {} : { year: "numeric" }),
  });

/** Moment où la photo a été prise : la date inscrite dans la photo (photos importées), sinon celle du fichier. */
export async function datePhoto(file: File): Promise<string> {
  try {
    const exifr = (await import("exifr")).default;
    const exif = await exifr.parse(file, ["DateTimeOriginal", "CreateDate"]);
    const d: unknown = exif?.DateTimeOriginal ?? exif?.CreateDate;
    if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
  } catch {
    /* pas de données dans la photo */
  }
  return new Date(file.lastModified || Date.now()).toISOString();
}

function redimensionner(img: HTMLImageElement, max: number, qualite: number): string {
  const ratio = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * ratio);
  canvas.height = Math.round(img.naturalHeight * ratio);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", qualite);
}

/**
 * Prépare une photo : une version réduite (1568 px) envoyée en lecture, rapide sur réseau cellulaire,
 * et une version en haute résolution (2400 px) gardée pour le zoom quand la photo d'origine est plus grande.
 */
export async function reduire(file: File): Promise<{ image: string; originale: string | null }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const grande = Math.max(img.naturalWidth, img.naturalHeight) > 1700;
    return { image: redimensionner(img, 1568, 0.85), originale: grande ? redimensionner(img, 2400, 0.82) : null };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Tous les prix de toutes les visites (pour la comparaison, l'historique et les variations), lus par pages de 1000. */
export async function chargerTout(sb: SupabaseClient): Promise<ScanAvecVisite[]> {
  const tout: ScanAvecVisite[] = [];
  for (let debut = 0; debut < 20000; debut += 1000) {
    const { data, error } = await sb
      .from("scans")
      .select("*, visites(id, banniere, magasin, date_visite)")
      .order("created_at", { ascending: false })
      .range(debut, debut + 999);
    if (error) throw new Error(error.message);
    tout.push(...((data ?? []) as unknown as ScanAvecVisite[]));
    if (!data || data.length < 1000) break;
  }
  return tout;
}

/** Prix de référence pour une liste de CUP (seulement ceux demandés : la liste complète peut être très longue). */
export async function chargerReferences(sb: SupabaseClient, cups: (string | null)[]): Promise<Map<string, Reference>> {
  const cles = [...new Set(cups.map(cupNormalise).filter(Boolean))];
  const refs = new Map<string, Reference>();
  for (let i = 0; i < cles.length; i += 150) {
    const { data } = await sb.from("reference_prix").select("cup, nom, prix").in("cup", cles.slice(i, i + 150));
    for (const r of (data ?? []) as Reference[]) refs.set(r.cup, { ...r, prix: Number(r.prix) });
  }
  return refs;
}

/* Icônes au trait */
const Icone = ({ d }: { d: string[] }) => (
  <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
    {d.map((p) => <path key={p} d={p} />)}
  </svg>
);
export const ICamera = () => <Icone d={["M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z", "M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"]} />;
export const IEtiquette = () => <Icone d={["M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z", "M7.5 7.5h.01"]} />;
export const IAssistant = () => <Icone d={["M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z", "M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"]} />;
export const IMagasin = () => <Icone d={["M4 9l1.2-5h13.6L20 9", "M4 9v11h16V9", "M4 9a2.7 2.7 0 0 0 5.33 0 2.7 2.7 0 0 0 5.34 0A2.7 2.7 0 0 0 20 9", "M9.5 20v-5h5v5"]} />;
export const IListe = () => <Icone d={["M4 6.5l1.5 1.5L8 5", "M4 12.5l1.5 1.5L8 11", "M4 18.5l1.5 1.5L8 17", "M11.5 6.5H20", "M11.5 12.5H20", "M11.5 18.5H20"]} />;
export const IComparer = () => <Icone d={["M5 20V10", "M12 20V4", "M19 20v-7"]} />;
export const IEnvoyer = () => <Icone d={["M12 19V5", "M6 11l6-6 6 6"]} />;
export const IPlus = () => <Icone d={["M12 5v14", "M5 12h14"]} />;
export const IPhotos = () => <Icone d={["M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", "M3 16l5-5 4 4 3-3 6 6", "M15.5 9.5h.01"]} />;
export const IFermer = () => <Icone d={["M6 6l12 12", "M18 6L6 18"]} />;
export const IPoubelle = () => <Icone d={["M4 7h16", "M9 7V4h6v3", "M6 7l1 13h10l1-13", "M10 11v6", "M14 11v6"]} />;
export const IPartage = () => <Icone d={["M12 15V4", "M7.5 8.5L12 4l4.5 4.5", "M5 13v6h14v-6"]} />;
export const IExport = () => <Icone d={["M12 4v11", "M7.5 10.5L12 15l4.5-4.5", "M5 20h14"]} />;
export const IRecherche = () => <Icone d={["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M20 20l-3.8-3.8"]} />;
export const ICodeBarres = () => <Icone d={["M4 6v12", "M7.5 6v12", "M10.5 6v12", "M14 6v12", "M17 6v12", "M20 6v12"]} />;
export const ICoche = () => <Icone d={["M5 12.5l4.5 4.5L19 7.5"]} />;
export const IHorsLigne = () => <Icone d={["M4 4l16 16", "M8.5 16.5a5 5 0 0 1 7 0", "M5.5 13a9.5 9.5 0 0 1 3.4-2.2", "M13 9.6a9.5 9.5 0 0 1 5.5 3.4", "M2.5 9.5A14 14 0 0 1 6 7.2", "M10.5 5.1A14 14 0 0 1 21.5 9.5", "M12 20h.01"]} />;
export const IPosition = () => <Icone d={["M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z", "M12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z"]} />;
export const IJournal = () => <Icone d={["M5 4h14v16H5z", "M8.5 8h7", "M8.5 12h7", "M8.5 16h4"]} />;
export const ICrayon = () => <Icone d={["M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5 4 20z", "M14.5 6l3 3"]} />;
export const IEffacer = () => <Icone d={["M5 7h14", "M9 7V4.5h6V7", "M7 7l1 12.5h8L17 7"]} />;
export const IReglages = () => <Icone d={["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", "M15 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z", "M9 19.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"]} />;
export const IAlerte = () => <Icone d={["M12 4l9 15.5H3L12 4z", "M12 10v4.5", "M12 17.2h.01"]} />;
export const IRestaurer = () => <Icone d={["M4 12a8 8 0 1 0 2.6-5.9", "M4 4.5V9h4.5"]} />;
export const IChevron = () => <Icone d={["M6 9l6 6 6-6"]} />;
export const IPlusMenu = () => <Icone d={["M5 12h.01", "M12 12h.01", "M19 12h.01"]} />;
