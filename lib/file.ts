/**
 * File d'attente des photos, gardée sur l'appareil (IndexedDB).
 * Une photo y reste jusqu'à ce qu'elle soit lue : sans réseau, ou si l'app est fermée, rien n'est perdu.
 */

export type PhotoEnAttente = {
  id: string;
  visiteId: string;
  image: string; // photo réduite, envoyée en lecture
  originale: string | null; // photo en haute résolution, gardée pour le zoom
  priseLe: string;
  signee?: boolean; // la copie gardée porte la signature : elle remplace aussi la photo de base
  mode: "carte" | "circulaire";
};

const NOM = "scanprix";
const MAGASIN = "photos";

function ouvrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const demande = indexedDB.open(NOM, 1);
    demande.onupgradeneeded = () => demande.result.createObjectStore(MAGASIN, { keyPath: "id" });
    demande.onsuccess = () => resolve(demande.result);
    demande.onerror = () => reject(demande.error);
  });
}

async function operation<T>(mode: IDBTransactionMode, action: (magasin: IDBObjectStore) => IDBRequest): Promise<T> {
  const base = await ouvrir();
  return new Promise<T>((resolve, reject) => {
    const transaction = base.transaction(MAGASIN, mode);
    const demande = action(transaction.objectStore(MAGASIN));
    transaction.oncomplete = () => { base.close(); resolve(demande.result as T); };
    transaction.onerror = () => { base.close(); reject(transaction.error); };
    transaction.onabort = () => { base.close(); reject(transaction.error); };
  });
}

export const ajouterPhoto = (p: PhotoEnAttente) => operation<IDBValidKey>("readwrite", (m) => m.put(p));
export const retirerPhoto = (id: string) => operation<undefined>("readwrite", (m) => m.delete(id));
export const photosEnAttente = () => operation<PhotoEnAttente[]>("readonly", (m) => m.getAll());
