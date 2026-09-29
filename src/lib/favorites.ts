/**
 * Favorites are stored per browser in localStorage. Storage can be missing or throw
 * (private mode, blocked site data), so every access is guarded and the app simply
 * behaves as if there were no favorites.
 */
export const FAVORITES_KEY = "hudson-transit:favorites";
const MAX_FAVORITES = 12;

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

export function parseFavorites(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const ids = value.filter((v): v is string => typeof v === "string" && v.length > 0);
    return [...new Set(ids)].slice(0, MAX_FAVORITES);
  } catch {
    return [];
  }
}

export function toggleFavorite(favorites: string[], id: string): string[] {
  return favorites.includes(id)
    ? favorites.filter((f) => f !== id)
    : [...favorites, id].slice(-MAX_FAVORITES);
}

export function loadFavorites(storage: ReadableStorage | undefined): string[] {
  try {
    return parseFavorites(storage?.getItem(FAVORITES_KEY) ?? null);
  } catch {
    return [];
  }
}

export function saveFavorites(storage: WritableStorage | undefined, favorites: string[]): void {
  try {
    storage?.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  } catch {
    // Quota exceeded or storage disabled: favorites just won't persist this session.
  }
}
