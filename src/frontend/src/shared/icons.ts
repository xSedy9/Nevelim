/**
 * Inline SVG icon set shared by all windows (modal, settings, overlay).
 *
 * Stroke-based lucide-style glyphs, 24x24 viewBox, `currentColor` so icons
 * inherit text color. No icon fonts, no emoji.
 */

export type IconName =
  | "folder"
  | "file"
  | "x"
  | "arrow-left"
  | "check"
  | "copy"
  | "save"
  | "send"
  | "sparkle"
  | "warning"
  | "zap"
  | "sliders";

/** SVG inner markup per icon name (paths only; wrapper is added by `icon`). */
const PATHS: Record<IconName, string> = {
  folder:
    '<path d="M4 6a2 2 0 0 1 2-2h3.2a2 2 0 0 1 1.6.8L12 6h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
  file:
    '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  "arrow-left": '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  copy:
    '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  save:
    '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  sparkle:
    '<path fill="currentColor" stroke="none" d="M12 2.6l1.87 5.83a2 2 0 0 0 1.3 1.3l5.83 1.87-5.83 1.87a2 2 0 0 0-1.3 1.3L12 20.63l-1.87-5.83a2 2 0 0 0-1.3-1.3L2.9 11.63l5.83-1.87a2 2 0 0 0 1.3-1.3z"/>',
  warning:
    '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  sliders:
    '<path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/>',
};

/**
 * Renders an inline SVG icon.
 *
 * @param name icon name from the set
 * @param size rendered size in px (default 16)
 * @returns SVG markup string with `stroke="currentColor"`
 */
export function icon(name: IconName, size = 16): string {
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`
  );
}
