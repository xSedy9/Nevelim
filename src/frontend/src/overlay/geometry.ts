/**
 * Layout geometry of the overlay canvas.
 *
 * The constants mirror the legacy Python overlay 1:1 so the Tauri version
 * keeps the exact same visual composition.
 */

/** Hub circle placement (radius reduced ~20% from the legacy 24 per user preference). */
export const HUB = { x: 685, y: 290, r: 19 } as const;

/** Snippet pill geometry and list layout. */
export const SNIPPET = { x: 795, width: 285, height: 42, step: 46, visible: 5 } as const;

/** Action pill geometry. */
export const ACTION = { x: 1125, width: 210, height: 40, step: 44 } as const;

/** Settings pill geometry: mirrors the snippet column on the LEFT of the hub
 * (~20% narrower than a snippet pill per user preference). */
export const SETTINGS = {
  x: HUB.x - 110 - 228,
  width: 228,
  height: 42,
  rightEdge: HUB.x - 110,
} as const;

/** Settings action pill geometry: mirrors the snippet actions on the LEFT of
 * the settings pill (same 45px gap and 210px pill as the snippet actions). */
export const SETTINGS_ACTION = {
  x: SETTINGS.x - 45 - 210,
  width: 210,
  height: 40,
  step: 44,
  rightEdge: SETTINGS.x - 45,
} as const;

/** Logical size of the overlay canvas (must match the Tauri window). */
export const CANVAS = { width: 1430, height: 580 } as const;

/** Y position of the snippet slot holding template index `index`. */
export function slotY(index: number, scroll: number): number {
  return HUB.y + (index - scroll - 2) * SNIPPET.step;
}

/** Y position of action row `k` attached to a snippet slot at `y`. */
export function actionY(y: number, k: number): number {
  return y + (k - 1.5) * ACTION.step;
}

/** Bezier connector path from the hub edge to a pill left edge. */
export function connectorPath(y: number, toX: number): string {
  const x0 = HUB.x + HUB.r;
  const y0 = HUB.y;
  const c1x = x0 + 40;
  const c2x = toX - 40;
  return `M ${x0} ${y0} C ${c1x} ${y0}, ${c2x} ${y}, ${toX} ${y}`;
}

/** Bezier connector path from the hub LEFT edge to the settings pill right edge. */
export function settingsConnectorPath(y: number): string {
  const x0 = HUB.x - HUB.r;
  const y0 = HUB.y;
  const c1x = x0 - 40;
  const c2x = SETTINGS.rightEdge + 40;
  return `M ${x0} ${y0} C ${c1x} ${y0}, ${c2x} ${y}, ${SETTINGS.rightEdge} ${y}`;
}

/** Bezier connector path from a snippet right edge to an action pill. */
export function actionConnectorPath(fromY: number, y: number, toX: number): string {
  const x0 = SNIPPET.x + SNIPPET.width;
  const c1x = x0 + 40;
  const c2x = toX - 40;
  return `M ${x0} ${fromY} C ${c1x} ${fromY}, ${c2x} ${y}, ${toX} ${y}`;
}

/** Bezier connector path from the settings pill LEFT edge to a settings action
 * pill (mirror of [`actionConnectorPath`]). */
export function settingsActionConnectorPath(fromY: number, y: number, toX: number): string {
  const x0 = SETTINGS.x;
  const c1x = x0 - 40;
  const c2x = toX + 40;
  return `M ${x0} ${fromY} C ${c1x} ${fromY}, ${c2x} ${y}, ${toX} ${y}`;
}

/** Top/bottom square bracket polyline around the visible snippet list.
 *
 * @param kind "top" | "bottom"
 * @param visibleCount Number of visible items to frame (1..5, defaults to SNIPPET.visible).
 */
export function bracketPath(kind: "top" | "bottom", visibleCount: number = SNIPPET.visible): string {
  const inset = 35;
  const arm = 6;
  const x1 = SNIPPET.x + inset;
  const x2 = SNIPPET.x + SNIPPET.width - inset;
  const clamped = Math.min(Math.max(1, visibleCount), SNIPPET.visible);
  const bottomSlot = clamped - 1;
  const y =
    kind === "top"
      ? slotY(0, 0) - SNIPPET.height / 2 - 14
      : slotY(bottomSlot, 0) + SNIPPET.height / 2 + 14;
  const dir = kind === "top" ? arm : -arm;
  return `M ${x1} ${y + dir} L ${x1} ${y} L ${x2} ${y} L ${x2} ${y + dir}`;
}

/** Builds an SVG path for the filled Gemini-style sparkle centered at (cx, cy). */
export function sparklePath(cx: number, cy: number, r: number): string {
  const pts: Array<[number, number]> = [
    [0, -9],
    [2.0357, -3.83847],
  ];
  const curves: Array<[[number, number], [number, number], [number, number]]> = [
    [
      [2.2236, -3.36201],
      [2.3175, -3.12378],
      [2.4614, -2.9229],
    ],
    [
      [2.5889, -2.74484],
      [2.7448, -2.58894],
      [2.9229, -2.46141],
    ],
    [
      [3.1238, -2.31755],
      [3.362, -2.22359],
      [3.8385, -2.03568],
    ],
  ];
  const steps = 10;
  for (const [c1, c2, p] of curves) {
    const [x0, y0] = pts[pts.length - 1];
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      const x = u ** 3 * x0 + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * p[0];
      const y = u ** 3 * y0 + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * p[1];
      pts.push([x, y]);
    }
  }
  pts.push([9, 0]);
  const rot = (q: Array<[number, number]>): Array<[number, number]> =>
    q.map(([x, y]) => [-y, x] as [number, number]);
  const outline = [...pts, ...rot(pts), ...rot(rot(pts)), ...rot(rot(rot(pts)))];
  const scale = r / 9;
  return (
    outline
      .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${cx + x * scale} ${cy + y * scale}`)
      .join(" ") + " Z"
  );
}

/** Click hit radius around the hub (legacy: r + 14). */
export const HUB_HIT_RADIUS = HUB.r + 14;

/** Whether a click at canvas point (x, y) lands on the hub circle. */
export function isHubClick(x: number, y: number): boolean {
  const dx = x - HUB.x;
  const dy = y - HUB.y;
  return dx * dx + dy * dy <= HUB_HIT_RADIUS * HUB_HIT_RADIUS;
}

/** Whether a click lands inside the snippet pill for visible slot `slot`. */
export function isSnippetClick(x: number, y: number, slot: number, scroll: number): boolean {
  const sy = slotY(slot, scroll);
  return (
    x >= SNIPPET.x &&
    x <= SNIPPET.x + SNIPPET.width &&
    y >= sy - SNIPPET.height / 2 &&
    y <= sy + SNIPPET.height / 2
  );
}

/** Whether a click lands inside the settings pill. */
export function isSettingsClick(x: number, y: number): boolean {
  return (
    x >= SETTINGS.x &&
    x <= SETTINGS.x + SETTINGS.width &&
    y >= HUB.y - SETTINGS.height / 2 &&
    y <= HUB.y + SETTINGS.height / 2
  );
}

/** Y position of settings action row `k`. The middle action sits exactly on
 * the settings pill row (odd count, vertically centered stack). */
export function settingsActionY(k: number): number {
  return HUB.y + (k - 1) * SETTINGS_ACTION.step;
}

/** Whether a click lands inside settings action row `k`. */
export function isSettingsActionClick(x: number, y: number, k: number): boolean {
  const ay = settingsActionY(k);
  return (
    x >= SETTINGS_ACTION.x &&
    x <= SETTINGS_ACTION.x + SETTINGS_ACTION.width &&
    y >= ay - SETTINGS_ACTION.height / 2 &&
    y <= ay + SETTINGS_ACTION.height / 2
  );
}

/** Whether a click lands inside action row `k` attached to slot `y`. */
export function isActionClick(x: number, y: number, slotYValue: number, k: number): boolean {
  const ay = actionY(slotYValue, k);
  return (
    x >= ACTION.x &&
    x <= ACTION.x + ACTION.width &&
    y >= ay - ACTION.height / 2 &&
    y <= ay + ACTION.height / 2
  );
}
