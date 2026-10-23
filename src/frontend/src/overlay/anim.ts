/**
 * Overlay animation sequencing.
 *
 * All motion is CSS-transition/animation driven; this module only orchestrates
 * class toggles and staggers, and returns promises so the state machine can
 * chain phases like the legacy implementation did.
 */

import type { OverlayDom } from "./render";

/** Wait helper. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Double requestAnimationFrame - guarantees styles are committed before toggling. */
export async function nextFrames(): Promise<void> {
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

/** Hub bloom-in (scale 0.2 -> 1 + fade). ~300 ms. */
export async function hubBloom(dom: OverlayDom): Promise<void> {
  dom.hub.classList.remove("hub--hidden", "hub--sucked");
  dom.root.classList.remove("closing");
  dom.hub.classList.add("hub--bloom");
  await nextFrames();
  dom.hub.classList.remove("hub--bloom");
  await sleep(320);
}

/** Expands snippet pills with the legacy stagger (i * 55 ms). ~500 ms. */
export async function expandSnippets(dom: OverlayDom): Promise<void> {
  dom.pills.forEach(({ pill, line }, i) => {
    const delay = `${i * 55}ms`;
    pill.style.transitionDelay = delay;
    line.style.transitionDelay = delay;
  });
  await nextFrames();
  dom.root.classList.add("expanded");
  await sleep(500);
  dom.pills.forEach(({ pill, line }) => {
    pill.style.transitionDelay = "";
    line.style.transitionDelay = "";
  });
}

/** Retracts snippet pills back into the hub. ~300 ms. */
export async function retractSnippets(dom: OverlayDom): Promise<void> {
  dom.root.classList.remove("expanded");
  await sleep(320);
}

/** Expands the action pills of the selected slot. ~350 ms. */
export async function expandActions(dom: OverlayDom): Promise<void> {
  dom.actionPills.forEach(({ pill, line }, k) => {
    const delay = `${k * 45}ms`;
    pill.style.transitionDelay = delay;
    line.style.transitionDelay = delay;
  });
  await nextFrames();
  dom.root.classList.add("actions-open");
  await sleep(380);
  dom.actionPills.forEach(({ pill, line }) => {
    pill.style.transitionDelay = "";
    line.style.transitionDelay = "";
  });
}

/** Retracts the action pills. ~250 ms. */
export async function retractActions(dom: OverlayDom): Promise<void> {
  dom.root.classList.remove("actions-open");
  await sleep(260);
}

/**
 * Suck-in close: everything fades, the hub implodes into itself (accelerating
 * ease) while an energy ring collapses inward. ~400 ms.
 */
export async function suckInClose(dom: OverlayDom): Promise<void> {
  dom.root.classList.add("closing");
  dom.hub.classList.add("hub--sucked");
  dom.ring.classList.add("ring--active");
  await sleep(400);
  dom.ring.classList.remove("ring--active");
}

/** Resets all transient classes after the overlay was hidden. */
export function resetAfterHide(dom: OverlayDom): void {
  dom.root.classList.remove("closing", "expanded", "actions-open", "phase-snippets", "phase-actions");
  dom.root.classList.add("phase-hub");
  dom.hub.classList.add("hub--hidden");
  dom.hub.classList.remove("hub--sucked");
  dom.ring.classList.remove("ring--active");
}
