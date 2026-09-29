/**
 * Recherche tolérante aux fautes de frappe : distance de Damerau-Levenshtein restreinte (OSA)
 * avec arrêt anticipé, appliquée aux mots entiers et à leurs préfixes (saisie en cours).
 */

/** Distance d'édition (insertion, suppression, substitution, transposition) ; renvoie max + 1 au-delà de `max`. */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    [prev2, prev] = [prev, cur];
  }
  return prev[b.length];
}

/** Fautes tolérées selon la longueur du terme : 0 (< 4 lettres), 1 (4–7), 2 (≥ 8). */
const tolerance = (term) => (term.length >= 8 ? 2 : term.length >= 4 ? 1 : 0);

/** Découpe un texte normalisé en mots indexables. */
export const toWords = (text) => text.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);

/**
 * Vrai si `term` figure dans `text` (sous-chaîne exacte) ou s'approche d'un mot / préfixe de mot.
 * @param {string} term terme normalisé (minuscules, sans accents)
 * @param {string} text texte normalisé
 * @param {string[]} words toWords(text), précalculé
 */
export function fuzzyIncludes(term, text, words) {
  if (text.includes(term)) return true;
  const max = tolerance(term);
  if (!max) return false;
  return words.some((w) => distance(term, w, max) <= max || (w.length > term.length && distance(term, w.slice(0, term.length), max) <= max));
}
