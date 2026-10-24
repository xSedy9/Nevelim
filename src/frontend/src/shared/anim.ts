/**
 * Shared micro-animation helpers (per the Smooth Animations spec: width is
 * tweened explicitly because `width: auto` cannot transition).
 */

/** Swaps a button's inner HTML while smoothly animating its width to fit.
 *
 * The old width is pinned, content is swapped off-screen, and the width
 * tweens to the new natural size; after the tween the inline width is
 * released so the button stays flexible. */
export function swapButtonContent(btn: HTMLButtonElement, html: string): void {
  const prev = btn.getBoundingClientRect().width;
  btn.style.width = "auto";
  btn.innerHTML = html;
  const target = btn.getBoundingClientRect().width;
  btn.style.width = `${prev}px`;
  void btn.offsetWidth; // flush so the width transition starts from prev
  btn.style.width = `${target}px`;
  window.setTimeout(() => {
    btn.style.width = "";
  }, 300);
}
