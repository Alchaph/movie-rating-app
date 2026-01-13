// helpers/formatDate.js
// Formats a date object to a localized string

/**
 * Format a date to a localized string
 * @param {Date|string} date - The date to format
 * @param {string} locale - The locale to use (default: 'de-CH')
 * @returns {string} Formatted date string
 */
export default function formatDate(date, locale = 'de-CH') {
  try {
    const d = date instanceof Date ? date : new Date(date);
    return new Intl.DateTimeFormat(locale).format(d);
  } catch {
    return '';
  }
}
