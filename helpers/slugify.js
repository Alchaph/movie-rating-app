// helpers/slugify.js
// Converts a string into a URL-friendly slug
// Examples:
//   "Die Zeitmaschine!" -> "die-zeitmaschine"
//   "Komödie: Café au lait" -> "komoedie-cafe-au-lait"

/**
 * Convert a string to a URL-friendly slug
 * @param {string} input - The string to slugify
 * @returns {string} URL-friendly slug
 */
export default function slugify(input) {
  if (!input) return '';
  
  return String(input)
    .normalize('NFKD')                    // Separate accents (ä -> a + ¨)
    .replace(/[\u0300-\u036f]/g, '')      // Remove combining characters
    .toLowerCase()
    .replace(/&/g, ' und ')               // Replace & with 'und'
    .replace(/[^a-z0-9]+/g, '-')          // Replace non-alphanumeric with -
    .replace(/^-+|-+$/g, '')              // Remove leading/trailing dashes
    .replace(/-{2,}/g, '-');              // Replace multiple dashes with single
}
