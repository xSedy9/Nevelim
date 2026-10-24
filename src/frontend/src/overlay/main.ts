/**
 * Overlay entry point: wires the state machine, rendering, animations,
 * navigation input and the Tauri event protocol together.
 */

import { listen } from "@tauri-apps/api/event";

import { api, type AppStateDto } from "../shared/ipc";
import {
  SNIPPET,
  isActionClick,
  isHubClick,
  isSettingsActionClick,
  isSettingsClick,
  isSnippetClick,
  slotY,
} from "./geometry";
import {
  initialModel,
  moveDown,
  moveUp,
  expand,
  openSettingsEntry,
  retract,
  type OverlayModel,
} from "./state";
import { buildOverlay, update, type OverlayDom, type SnippetInfo } from "./render";
import { expandActions, expandSnippets, hubBloom, resetAfterHide, sleep, suckInClose } from "./anim";

/** Action keys in selection order. */
const ACTION_KEYS = ["copy", "paste", "edit", "adapt"] as const;
type ActionKey = (typeof ACTION_KEYS)[number];

/** Mutable runtime session state. */
const session = {
  model: initialModel(0),
  templates: [] as SnippetInfo[],
  dom: null as OverlayDom | null,
  animating: false,
  closing: false,
  lastHit: false,
};

/** Applies a model change to the DOM (cheap; motion handled by CSS). */
function apply(model: OverlayModel): void {
  session.model = model;
  if (session.dom) update(session.dom, session.model);
}

/** Runs an animated phase transition while suppressing input. */
async function animate(fn: () => Promise<void>): Promise<void> {
  if (session.animating || session.closing) return;
  session.animating = true;
  try {
    await fn();
  } finally {
    session.animating = false;
  }
}

/** Expands hub -> snippets with animation. */
function expandToSnippets(): void {
  const next = expand(session.model);
  if (!next) return;
  void animate(async () => {
    apply(next);
    await expandSnippets(session.dom!);
  });
}

/** Expands snippets -> actions with animation. */
function expandToActions(): void {
  const next = expand(session.model);
  if (!next) return;
  void animate(async () => {
    apply(next);
    await expandActions(session.dom!);
  });
}

/** Retracts one level with animation. */
function retractOne(): void {
  const next = retract(session.model);
  if (!next) return;
  void animate(async () => {
    // Apply first: CSS transitions start moving/fading immediately, the sleep
    // only keeps input locked until the motion settles.
    apply(next);
    if (next.phase === "snippets") await sleep(300);
    else await sleep(260);
  });
}

/** Expands settings -> settings-actions with animation (Left / RMB / Enter). */
function expandSettingsActions(): void {
  const next = expand(session.model);
  if (!next) return;
  void animate(async () => {
    apply(next);
    await sleep(300);
  });
}

/** Executes the currently selected action (Enter / Space / click). */
function onConfirm(): void {
  if (session.model.phase === "snippets") expandToActions();
  else if (session.model.phase === "hub") expandToSnippets();
  else if (session.model.phase === "settings") expandSettingsActions();
  else if (session.model.phase === "settings-actions") {
    void runSettingsAction(SETTINGS_ACTION_KEYS[session.model.actionSelected]);
  } else if (session.model.phase === "actions") {
    const t = session.templates[session.model.selected];
    if (t) void runAction(ACTION_KEYS[session.model.actionSelected], t);
  }
}

/** Animated selection move (up). */
function navUp(): void {
  const prev = session.model;
  const next = moveUp(prev);
  if (next !== prev) apply(next);
}

/** Animated selection move (down). */
function navDown(): void {
  const prev = session.model;
  const next = moveDown(prev);
  if (next !== prev) apply(next);
}

/** Executes an action and closes the overlay. */
async function runAction(key: ActionKey, template: SnippetInfo): Promise<void> {
  switch (key) {
    case "copy":
      await api.copyText(template.content);
      await closeAnimated();
      break;
    case "paste":
      await api.pasteSnippet(template.content);
      await closeAnimated();
      break;
    case "edit":
      await api.openPath(template.path);
      await closeAnimated();
      break;
    case "adapt":
      // The modal is a separate window and steals focus: the blur handler
      // starts hiding, hideAndReset guarantees the overlay is hidden and the
      // closing flag is released even if no blur event arrives.
      await api.openModal(template.name, template.content);
      await hideAndReset();
      break;
  }
}

/** Opens the settings window and hides the overlay. */
async function openSettingsWindow(): Promise<void> {
  await api.openSettings();
  await hideAndReset();
}

/** Settings action keys in fanout order. */
const SETTINGS_ACTION_KEYS = ["open", "export", "import"] as const;
type SettingsActionKey = (typeof SETTINGS_ACTION_KEYS)[number];

/** Shows a transient toast message in the overlay (export feedback etc.). */
async function toast(message: string, isError = false): Promise<void> {
  if (!session.dom || session.closing) return;
  const t = document.createElement("div");
  t.className = `toast${isError ? " toast--err" : ""}`;
  t.textContent = message;
  session.dom.root.appendChild(t);
  await sleep(30);
  t.classList.add("shown");
  await sleep(1600);
  t.classList.remove("shown");
  await sleep(260);
  t.remove();
}

/** Executes a settings action and hides the overlay. */
async function runSettingsAction(key: SettingsActionKey): Promise<void> {
  switch (key) {
    case "open":
      await openSettingsWindow();
      break;
    case "export": {
      let failure = "";
      try {
        await api.exportTemplates();
      } catch (e) {
        failure = String(e);
      }
      // Success feedback is the opened export folder itself; only failures
      // need an explicit message.
      if (failure) await toast(failure, true);
      await hideAndReset();
      break;
    }
    case "import":
      await api.openImport();
      await hideAndReset();
      break;
  }
}

/** Hides the window and resets the UI, always releasing the closing flag. */
async function hideAndReset(): Promise<void> {
  session.closing = true;
  try {
    await api.hideOverlay();
  } finally {
    if (session.dom) resetAfterHide(session.dom);
    apply(initialModel(session.templates.length));
    session.closing = false;
  }
}

/** Suck-in close animation followed by hiding the window. */
export async function closeAnimated(): Promise<void> {
  if (session.closing) return;
  session.closing = true;
  try {
    await suckInClose(session.dom!);
  } finally {
    await hideAndReset();
  }
}

/** Reloads templates/config and rebuilds the static DOM.
 *
 * @param hidden when true (initial boot, window invisible) the hub is built
 *               in the hidden state; otherwise a bloom-in is played and the
 *               hub stays visible.
 */
export async function refreshState(hidden = false): Promise<void> {
  const state: AppStateDto = await api.getAppState();
  session.templates = state.templates.map((t) => ({ name: t.name, path: t.path, content: t.content }));
  const root = document.getElementById("overlay-root") as HTMLDivElement;
  session.dom = buildOverlay(root, session.templates);
  session.model = initialModel(session.templates.length);
  apply(session.model);
  wireClicks();
  if (hidden) {
    session.dom.hub.classList.add("hub--hidden");
  } else {
    await hubBloom(session.dom);
  }
}

/** Wires mouse clicks (only fire when native input is enabled). */
function wireClicks(): void {
  const dom = session.dom!;
  dom.hub.addEventListener("click", () => {
    if (session.model.phase === "hub") expandToSnippets();
    else retractOne();
  });
  dom.pills.forEach(({ pill }, i) => {
    pill.addEventListener("click", () => {
      if (session.model.phase === "hub" || session.animating) return;
      if (session.model.phase === "actions" && session.model.selected === i) {
        retractOne();
        return;
      }
      apply({ ...session.model, selected: i });
      expandToActions();
    });
  });
  dom.actionPills.forEach(({ pill }, k) => {
    pill.addEventListener("click", () => {
      const t = session.templates[session.model.selected];
      if (t) void runAction(ACTION_KEYS[k], t);
    });
  });
  dom.settingsPill.pill.addEventListener("click", () => {
    if (session.model.phase === "settings") onConfirm();
  });
  dom.settingsActions.forEach(({ pill }, k) => {
    pill.addEventListener("click", () => {
      if (session.model.phase === "settings-actions") {
        void runSettingsAction(SETTINGS_ACTION_KEYS[k]);
      }
    });
  });
  dom.root.addEventListener("click", (e) => {
    // Click on empty canvas space closes the overlay (legacy behaviour).
    const target = e.target as HTMLElement;
    if (target.closest(".hit")) return;
    void closeAnimated();
  });
}

/** Entry point. */
export async function main(): Promise<void> {
  await refreshState();

  // Navigation keyboard input.
  document.addEventListener("keydown", (e) => {
    if (session.closing || session.animating) return;
    switch (e.key) {
      case "ArrowUp":
        navUp();
        break;
      case "ArrowDown":
        navDown();
        break;
      case "ArrowLeft":
        // Left side of the canvas: Left dives deeper (executes the selected
        // action), mirroring Right on the right side.
        if (session.model.phase === "hub") {
          const next = openSettingsEntry(session.model);
          if (next) apply(next);
        } else if (
          session.model.phase === "settings" ||
          session.model.phase === "settings-actions"
        ) {
          onConfirm();
        } else {
          retractOne();
        }
        break;
      case "ArrowRight":
        // Right side: Right confirms; on the left side it retracts.
        if (session.model.phase === "settings" || session.model.phase === "settings-actions") {
          retractOne();
        } else {
          onConfirm();
        }
        break;
      case "Enter":
      case " ":
        onConfirm();
        break;
      case "Escape":
        void closeAnimated();
        break;
      default:
        if (session.model.phase === "actions" && /^[1-4]$/.test(e.key)) {
          const t = session.templates[session.model.selected];
          if (t) void runAction(ACTION_KEYS[Number(e.key) - 1], t);
        } else if (session.model.phase === "settings-actions" && /^[1-3]$/.test(e.key)) {
          void runSettingsAction(SETTINGS_ACTION_KEYS[Number(e.key) - 1]);
        }
    }
  });

  document.addEventListener(
    "wheel",
    (e) => {
      if (e.deltaY < 0) navUp();
      else navDown();
    },
    { passive: true },
  );

  // Right mouse button dives one level deeper: hub -> snippets and
  // settings -> settings actions.
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (session.animating || session.closing) return;
    if (session.model.phase === "hub") expandToSnippets();
    else if (session.model.phase === "settings") expandSettingsActions();
  });

  // Show/hide lifecycle. "overlay-shown" is emitted by the Rust side right
  // after the window becomes visible (more reliable than WebView2 focus
  // events for hidden->shown transitions).
  await listen("overlay-shown", async () => {
    if (session.closing) return;
    await refreshState();
  });
  await listen("tauri://blur", () => {
    // Modal opening also blurs the overlay; hide without animation.
    if (session.dom) {
      void hideAndReset();
    }
  });
  await listen("request-close", () => {
    void closeAnimated();
  });

  // Cursor hit-test protocol: enable native input only over interactive UI.
  let hit = false;
  await listen<{ x: number; y: number }>("cursor-pos", ({ payload }) => {
    if (!session.dom || session.closing) return;
    hit = isHit(payload.x, payload.y);
    if (hit !== session.lastHit) {
      session.lastHit = hit;
      void api.setOverlayInput(hit);
    }
  });
}

/** Hit-test helper over the canvas coordinates (kept exported for tests). */
export function isHit(x: number, y: number): boolean {
  if (isHubClick(x, y)) return true;
  if (session.model.phase === "settings") {
    return isSettingsClick(x, y);
  }
  if (session.model.phase === "settings-actions") {
    for (let k = 0; k < SETTINGS_ACTION_KEYS.length; k++) {
      if (isSettingsActionClick(x, y, k)) return true;
    }
    return false;
  }
  for (let slot = 0; slot < SNIPPET.visible; slot++) {
    const idx = session.model.scroll + slot;
    if (idx < session.model.count && isSnippetClick(x, y, slot, session.model.scroll)) return true;
  }
  if (session.model.phase === "actions") {
    const fromY = slotY(session.model.selected, session.model.scroll);
    for (let k = 0; k < ACTION_KEYS.length; k++) {
      if (isActionClick(x, y, fromY, k)) return true;
    }
  }
  return false;
}

main().catch((e) => console.error("overlay init failed", e));
