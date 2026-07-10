const COMBINING_DIACRITICS = /[̀-ͯ]/g;

/**
 * Turns an arbitrary human-readable name into a stable, URL-safe slug used
 * for derived ids (steps, scenarios). Returns `fallback` when nothing
 * slug-worthy remains (e.g. a name made only of punctuation).
 */
export function slugify(value: string, fallback = "item"): string {
  const slug = value
    .normalize("NFKD")
    .replace(COMBINING_DIACRITICS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}
