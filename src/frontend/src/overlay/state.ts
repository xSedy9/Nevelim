/**
 * Pure state machine of the overlay UI (phases, selection, scrolling).
 *
 * Kept free of DOM/Tauri code so it can be unit tested in isolation.
 */

/** UI phase, mirroring the legacy state machine. */
export type Phase = "hub" | "snippets" | "actions";

/** Number of simultaneously visible snippet slots. */
export const VISIBLE_SLOTS = 5;

/** Immutable overlay model. */
export interface OverlayModel {
  /** Current UI phase. */
  phase: Phase;
  /** Index of the selected template. */
  selected: number;
  /** Index of the template in the top visible slot. */
  scroll: number;
  /** Index of the selected action (only in the actions phase). */
  actionSelected: number;
  /** Total number of templates. */
  count: number;
}

/** Creates the initial hub-only model. */
export function initialModel(count: number): OverlayModel {
  return { phase: "hub", selected: 0, scroll: 0, actionSelected: 0, count: Math.max(0, count) };
}

/** Scrolls the viewport so `selected` stays within the visible window. */
export function clampScroll(m: OverlayModel): OverlayModel {
  let scroll = m.scroll;
  if (m.selected < scroll) scroll = m.selected;
  if (m.selected >= scroll + VISIBLE_SLOTS) scroll = m.selected - VISIBLE_SLOTS + 1;
  const maxScroll = Math.max(0, m.count - VISIBLE_SLOTS);
  scroll = Math.min(Math.max(0, scroll), maxScroll);
  return scroll === m.scroll ? m : { ...m, scroll };
}

/** Moves the selection up. Returns the same model when already at the top. */
export function moveUp(m: OverlayModel): OverlayModel {
  if (m.phase === "hub" || m.selected <= 0) return m;
  const next = clampScroll({ ...m, selected: m.selected - 1 });
  return next;
}

/** Moves the selection down (or expands from the hub). Returns the same model when at the bottom. */
export function moveDown(m: OverlayModel): OverlayModel {
  if (m.phase === "hub") return expand(m) ?? m;
  if (m.phase === "actions") {
    return m.actionSelected >= 3 ? m : { ...m, actionSelected: m.actionSelected + 1 };
  }
  if (m.selected >= m.count - 1) return m;
  return clampScroll({ ...m, selected: m.selected + 1 });
}

/** Expands one level: hub -> snippets -> actions. Returns null when impossible. */
export function expand(m: OverlayModel): OverlayModel | null {
  if (m.count === 0) return null;
  if (m.phase === "hub") return clampScroll({ ...m, phase: "snippets" });
  if (m.phase === "snippets") return { ...m, phase: "actions", actionSelected: 0 };
  return null;
}

/** Retracts one level: actions -> snippets -> hub. Returns null at the hub. */
export function retract(m: OverlayModel): OverlayModel | null {
  if (m.phase === "actions") return { ...m, phase: "snippets" };
  if (m.phase === "snippets") return { ...m, phase: "hub" };
  return null;
}

/** Selects an action row (clamped). */
export function selectAction(m: OverlayModel, k: number): OverlayModel {
  const k2 = Math.min(Math.max(0, k), 3);
  return k2 === m.actionSelected ? m : { ...m, actionSelected: k2 };
}
