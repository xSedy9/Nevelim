/**
 * Shared formatting helpers for the UI.
 */

/**
 * Formats a byte count with auto-scaled units (B -> KB -> MB -> GB).
 *
 * Uses one decimal place from KB upwards, matching the backend formatter.
 *
 * @param bytes size in bytes (negative/non-finite values are shown as `0 B`)
 */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = unit === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${rounded} ${units[unit]}`;
}
