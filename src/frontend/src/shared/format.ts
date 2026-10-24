/**
 * Shared formatting helpers for the UI.
 */

/**
 * Formats a byte count with auto-scaled units (Б -> КБ -> МБ -> ГБ).
 *
 * Uses one decimal place from КБ upwards, matching the backend formatter.
 *
 * @param bytes size in bytes (negative/non-finite values are shown as `0 Б`)
 */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = unit === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${rounded} ${units[unit]}`;
}
