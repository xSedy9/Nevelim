/**
 * Settings window entry point.
 *
 * Edits the local configuration (hotkey, AI provider, credentials, paste
 * behaviour) and saves it via the backend, which re-registers the global
 * hotkey. Black-and-white minimalist UI per the project design rules.
 */

import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { api, type AppConfig, type ProviderId } from "../shared/ipc";
import { swapButtonContent } from "../shared/anim";
import { icon, type IconName } from "../shared/icons";

/** Provider descriptors for the segmented control. */
const PROVIDERS: Array<{ id: ProviderId; label: string }> = [
  { id: "gemini", label: "Gemini" },
  { id: "openai", label: "OpenAI" },
  { id: "openrouter", label: "OpenRouter" },
];

/** Runtime session. */
const session = {
  cfg: null as AppConfig | null,
  /** Default export dir (display form, e.g. `~/Downloads`). */
  defaultDir: "",
  busy: false,
  /** Hotkey capture mode: clicks are swallowed into key recording. */
  capturing: false,
  /** Removes the active capture keydown listener. */
  cleanupCapture: null as (() => void) | null,
  /** Dismisses the currently open mini modal, if any. */
  dismissModal: null as (() => void) | null,
  /** JSON snapshot of the last saved/loaded config (dirty tracking). */
  saved: "",
  /** Window is playing its exit animation. */
  closing: false,
  root: null as unknown as HTMLDivElement,
};

/** Wait helper. */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Serializes the working config for dirty comparison. */
const snapshot = (): string => JSON.stringify(session.cfg);

/** Whether the form differs from the last saved state. */
function isDirty(): boolean {
  return session.cfg !== null && snapshot() !== session.saved;
}

/** Typed element factory. */
const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Small uppercase section label (per the design rules). */
function sectionLabel(frame: HTMLElement, text: string): void {
  const l = el("div", "s-label");
  l.textContent = text;
  frame.appendChild(l);
}

/** Builds a button with an optional leading SVG icon and a text label. */
function btn(cls: string, iconName: IconName | null, label: string): HTMLButtonElement {
  const b = el("button", `btn ${cls}`);
  b.innerHTML =
    `${iconName ? icon(iconName, 14) : ""}` + (label ? `<span>${label}</span>` : "");
  return b;
}

/** Renders the whole settings form from `session.cfg`. */
function render(): void {
  const cfg = session.cfg!;
  session.root.innerHTML = "";
  const frame = el("div", "frame");

  // Floating save button: slides in when there are unsaved changes.
  const fab = el("button", "save-fab hidden");
  fab.title = "Сохранить изменения";
  fab.innerHTML = icon("save", 18);
  fab.addEventListener("click", () => void saveFlow(fab));

  const closeBtn = el("button", "icon-btn");
  closeBtn.innerHTML = icon("x", 14);
  closeBtn.title = "Закрыть (Esc)";
  closeBtn.addEventListener("click", requestClose);
  frame.appendChild(closeBtn);

  const title = el("div", "title");
  title.setAttribute("data-drag", "");
  title.textContent = "Настройки";
  frame.appendChild(title);

  // Hotkey: click the field to record a new combination.
  sectionLabel(frame, "Горячая клавиша");
  const hotkeyInput = el("input", "input mono hotkey-input");
  hotkeyInput.readOnly = true;
  hotkeyInput.value = cfg.hotkey;
  hotkeyInput.title = "Нажмите, чтобы задать комбинацию";
  hotkeyInput.addEventListener("click", () => void startHotkeyCapture(hotkeyInput, fab));
  frame.appendChild(hotkeyInput);
  const hint = el("div", "hint");
  hint.textContent = "Клик по полю — запись комбинации, Esc — отмена";
  frame.appendChild(hint);

  // Provider segmented control.
  sectionLabel(frame, "Провайдер");
  const seg = el("div", "segmented");
  for (const p of PROVIDERS) {
    const b = el("button", "seg-btn");
    b.textContent = p.label;
    b.classList.toggle("active", cfg.provider === p.id);
    b.addEventListener("click", () => {
      if (session.busy || cfg.provider === p.id) return;
      cfg.provider = p.id;
      seg.querySelectorAll(".seg-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      syncProviderFields(keyInput, modelInput);
      refreshSaveButton(fab);
    });
    seg.appendChild(b);
  }
  frame.appendChild(seg);

  // API key + model for the selected provider.
  sectionLabel(frame, "API-ключ");
  const keyInput = el("input", "input mono");
  keyInput.type = "password";
  keyInput.value = keyOf(cfg, cfg.provider);
  keyInput.spellcheck = false;
  keyInput.placeholder = "Вставьте ключ провайдера";
  keyInput.addEventListener("input", () => {
    setKey(cfg, cfg.provider, keyInput.value);
    refreshSaveButton(fab);
  });
  frame.appendChild(keyInput);

  sectionLabel(frame, "Модель");
  const modelInput = el("input", "input mono");
  modelInput.value = modelOf(cfg, cfg.provider);
  modelInput.spellcheck = false;
  modelInput.addEventListener("input", () => {
    setModel(cfg, cfg.provider, modelInput.value);
    refreshSaveButton(fab);
  });
  frame.appendChild(modelInput);

  // Provider availability check: sends a minimal request with the CURRENT
  // form values (unsaved edits included).
  const checkRow = el("div", "check-row");
  const checkBtn = btn("btn-dark", "zap", "Проверить связь");
  const checkStatus = el("span", "check-status mono");
  checkBtn.addEventListener("click", () => void testProviderFlow(checkBtn, checkStatus));
  checkRow.append(checkBtn, checkStatus);
  frame.appendChild(checkRow);

  // Auto-paste toggle.
  const row = el("div", "toggle-row");
  const toggleLabel = el("span", "toggle-label", "Автовставка в предыдущее окно");
  const sw = el("label", "switch");
  const swInput = document.createElement("input");
  swInput.type = "checkbox";
  swInput.checked = cfg.paste_automatically;
  swInput.addEventListener("change", () => {
    cfg.paste_automatically = swInput.checked;
    refreshSaveButton(fab);
  });
  const track = el("span", "track");
  sw.append(swInput, track);
  row.append(toggleLabel, sw);
  frame.appendChild(row);
  const toggleHint = el("div", "hint");
  toggleHint.textContent =
    "Вкл — «Вставить» сразу вставляет сниппет в окно, активное до вызова меню; выкл — только копирует в буфер";
  frame.appendChild(toggleHint);

  // Export folder.
  sectionLabel(frame, "Папка экспорта");
  const dirRow = el("div", "dir-row");
  const dirLabel = el("span", "dir-label mono");
  const refreshDirLabel = () => {
    dirLabel.textContent = cfg.export_dir.trim() || session.defaultDir || "Не задана";
  };
  refreshDirLabel();
  const dirBtns = el("div", "dir-btns");
  const chooseDir = btn("btn-dark", "folder", "Выбрать…");
  chooseDir.addEventListener("click", () => void pickExportDir(cfg, refreshDirLabel, fab));
  const resetDir = btn("btn-ghost btn-icon", "x", "");
  resetDir.title = "Сбросить на папку по умолчанию";
  resetDir.addEventListener("click", () => {
    cfg.export_dir = "";
    refreshDirLabel();
    refreshSaveButton(fab);
  });
  dirBtns.append(chooseDir, resetDir);
  dirRow.append(dirLabel, dirBtns);
  frame.appendChild(dirRow);

  frame.appendChild(fab);
  session.root.appendChild(frame);
  // Stagger indices for the row entrance animation.
  Array.from(frame.children).forEach((child, i) => {
    (child as HTMLElement).style.setProperty("--i", String(Math.min(i, 9)));
  });
  requestAnimationFrame(() => {
    frame.classList.add("shown");
    refreshSaveButton(fab);
  });
}

/** Reads the API key of `provider` from the config. */
function keyOf(cfg: AppConfig, p: ProviderId): string {
  return p === "gemini" ? cfg.gemini_api_key : p === "openai" ? cfg.openai_api_key : cfg.openrouter_api_key;
}

/** Writes the API key of `provider` into the config. */
function setKey(cfg: AppConfig, p: ProviderId, value: string): void {
  if (p === "gemini") cfg.gemini_api_key = value;
  else if (p === "openai") cfg.openai_api_key = value;
  else cfg.openrouter_api_key = value;
}

/** Reads the model id of `provider` from the config. */
function modelOf(cfg: AppConfig, p: ProviderId): string {
  return p === "gemini" ? cfg.gemini_model : p === "openai" ? cfg.openai_model : cfg.openrouter_model;
}

/** Writes the model id of `provider` into the config. */
function setModel(cfg: AppConfig, p: ProviderId, value: string): void {
  if (p === "gemini") cfg.gemini_model = value;
  else if (p === "openai") cfg.openai_model = value;
  else cfg.openrouter_model = value;
}

/** Refreshes the key/model inputs when the provider segment changes. */
function syncProviderFields(keyInput: HTMLInputElement, modelInput: HTMLInputElement): void {
  const cfg = session.cfg!;
  keyInput.value = keyOf(cfg, cfg.provider);
  modelInput.value = modelOf(cfg, cfg.provider);
}

/** Folder picker flow for the export directory setting. */
async function pickExportDir(
  cfg: AppConfig,
  refresh: () => void,
  fab: HTMLButtonElement,
): Promise<void> {
  if (session.busy) return;
  session.busy = true;
  try {
    const folder = await api.pickFolder();
    if (folder) {
      cfg.export_dir = folder;
      refresh();
      refreshSaveButton(fab);
    }
  } finally {
    session.busy = false;
  }
}

/** Checks that the AI provider answers using the current form values. */
async function testProviderFlow(button: HTMLButtonElement, status: HTMLElement): Promise<void> {
  if (session.busy || !session.cfg) return;
  session.busy = true;
  const restore = setBusy(button, "Проверка…");
  status.classList.remove("ok", "bad");
  status.textContent = "";
  try {
    const cfg = session.cfg;
    await api.testProvider(cfg.provider, keyOf(cfg, cfg.provider), modelOf(cfg, cfg.provider));
    status.textContent = "Отвечает";
    status.classList.add("ok");
  } catch (e) {
    status.textContent = String(e);
    status.classList.add("bad");
  } finally {
    restore();
    session.busy = false;
  }
}

/** Maps a keyboard event to the canonical hotkey token of its main key. */
function keyToken(e: KeyboardEvent): string | null {
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return null;
  // Physical key codes keep hotkeys layout-independent (RU/EN alike).
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  if (/^F\d{1,2}$/.test(e.key)) return e.key.toLowerCase();
  const named: Record<string, string> = {
    " ": "space",
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    Enter: "enter",
    Tab: "tab",
    Backspace: "backspace",
    Delete: "delete",
    Home: "home",
    End: "end",
    PageUp: "pageup",
    PageDown: "pagedown",
    Insert: "insert",
  };
  return named[e.key] ?? null;
}

/** Enters hotkey capture: the next key combination becomes the hotkey. */
function startHotkeyCapture(input: HTMLInputElement, fab: HTMLButtonElement): void {
  if (session.busy || session.capturing || !session.cfg) return;
  session.capturing = true;
  input.classList.add("capturing");
  input.value = "Нажмите комбинацию… (Esc — отмена)";

  const onKey = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      endHotkeyCapture(input, fab);
      return;
    }
    const token = keyToken(e);
    if (token === null) return; // modifier alone: keep waiting
    const mods = [
      e.ctrlKey ? "ctrl" : "",
      e.altKey ? "alt" : "",
      e.shiftKey ? "shift" : "",
      e.metaKey ? "meta" : "",
    ].filter(Boolean);
    if (mods.length === 0) return; // bare keys are not valid global hotkeys
    session.cfg!.hotkey = [...mods, token].join("+");
    endHotkeyCapture(input, fab);
  };
  document.addEventListener("keydown", onKey, true);
  session.cleanupCapture = () => document.removeEventListener("keydown", onKey, true);
}

/** Leaves hotkey capture, showing the current value unless a new one was set. */
function endHotkeyCapture(input: HTMLInputElement, fab: HTMLButtonElement): void {
  session.capturing = false;
  input.classList.remove("capturing");
  session.cleanupCapture?.();
  session.cleanupCapture = null;
  input.value = session.cfg!.hotkey;
  refreshSaveButton(fab);
}

/** Closes directly, or warns about unsaved changes first. */
function requestClose(): void {
  if (session.busy) return;
  if (isDirty()) showWarnModal();
  else close();
}

/** Normalizes a save failure into a user-facing message. */
function saveErrorText(e: unknown): string {
  const raw = String(e);
  if (/api[-_ ]?key|unauthorized|401|403/i.test(raw)) {
    return "Проверьте API-ключ или доступность провайдера.";
  }
  return raw;
}

/** Persists the configuration with FAB feedback: spinner while saving, a green
 * check on success; on failure an error modal followed by a red cross, then
 * the button slides away. */
async function saveFlow(fab: HTMLButtonElement): Promise<void> {
  if (session.busy || !session.cfg || !isDirty()) return;
  session.busy = true;
  const original = fab.innerHTML;
  fab.classList.remove("hidden", "ok", "err");
  fab.classList.add("loading");
  fab.innerHTML = `<span class="spinner"></span>`;
  try {
    await api.saveSettings(session.cfg);
    session.saved = snapshot();
    fab.classList.remove("loading");
    fab.classList.add("ok");
    fab.innerHTML = icon("check", 18);
    await sleep(700);
    fab.classList.remove("ok");
    fab.innerHTML = original;
  } catch (e) {
    fab.innerHTML = original;
    await showErrorModal(saveErrorText(e));
    fab.classList.add("err");
    fab.innerHTML = icon("x", 18);
    await sleep(700);
    fab.classList.remove("err");
    fab.innerHTML = original;
  } finally {
    fab.classList.remove("loading");
    session.busy = false;
    refreshSaveButton(fab);
  }
}

/** Slides the save button in/out depending on the dirty state. */
function refreshSaveButton(fab: HTMLButtonElement): void {
  if (fab.classList.contains("loading")) return;
  fab.classList.toggle("hidden", !isDirty());
}

/** Shows a modal-in-modal error card (same look as the adaptation modal). */
function showErrorModal(message: string): Promise<void> {
  return new Promise((resolve) => {
    session.root.classList.add("error");
    const overlay = el("div", "mini-overlay");
    const card = el("div", "mini-card");
    const body = el("div", "mini-body");
    const ico = el("span", "mini-ico");
    ico.innerHTML = icon("warning", 20);
    const text = el("div", "mini-text");
    text.appendChild(el("div", "mini-title", "Ошибка"));
    const msg = el("div", "mini-msg");
    msg.textContent = message;
    text.appendChild(msg);
    body.append(ico, text);
    const foot = el("div", "mini-foot");
    const ok = btn("btn-dark", null, "OK");
    foot.appendChild(ok);
    card.append(body, foot);
    overlay.appendChild(card);

    const dismiss = () => {
      if (overlay.classList.contains("leaving")) return;
      overlay.classList.add("leaving");
      setTimeout(() => {
        overlay.remove();
        session.root.classList.remove("error");
        session.dismissModal = null;
        resolve();
      }, 180);
    };
    ok.addEventListener("click", dismiss);
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) dismiss();
    });
    session.dismissModal = dismiss;
    session.root.appendChild(overlay);
    // Keyboard-first: Enter confirms the dialog right away.
    ok.focus();
  });
}

/** Warns about unsaved changes: Cancel keeps editing, force closes the window. */
function showWarnModal(): void {
  const overlay = el("div", "mini-overlay");
  const card = el("div", "mini-card warn");
  const body = el("div", "mini-body");
  const ico = el("span", "mini-ico warn");
  ico.innerHTML = icon("warning", 20);
  const text = el("div", "mini-text");
  text.appendChild(el("div", "mini-title warn", "Предупреждение"));
  const msg = el("div", "mini-msg");
  msg.textContent = "Есть несохранённые изменения. Закрыть без сохранения?";
  text.appendChild(msg);
  body.append(ico, text);
  const foot = el("div", "mini-foot");
  const cancel = btn("btn-dark", null, "Отмена");
  const force = btn("btn-danger", null, "Все равно закрыть");
  foot.append(cancel, force);
  card.append(body, foot);
  overlay.appendChild(card);

  const dismiss = () => {
    if (overlay.classList.contains("leaving")) return;
    overlay.classList.add("leaving");
    setTimeout(() => {
      overlay.remove();
      session.dismissModal = null;
    }, 180);
  };
  cancel.addEventListener("click", dismiss);
  force.addEventListener("click", () => {
    dismiss();
    close();
  });
  overlay.addEventListener("pointerdown", (e) => {
    if (e.target === overlay) dismiss();
  });
  session.dismissModal = dismiss;
  session.root.appendChild(overlay);
  // Keyboard-first: Enter presses the safe default (Отмена).
  cancel.focus();
}

/** Swaps a button's content to a spinner state (width tweens smoothly). */
function setBusy(btnEl: HTMLButtonElement, label: string): () => void {
  const original = btnEl.innerHTML;
  btnEl.classList.add("loading");
  swapButtonContent(btnEl, `<span class="spinner"></span><span>${label}</span>`);
  return () => {
    btnEl.classList.remove("loading");
    swapButtonContent(btnEl, original);
  };
}

/** Closes the settings window with the exit animation. */
function close(): void {
  if (session.closing) return;
  session.closing = true;
  const frame = session.root.querySelector(".frame");
  if (frame) {
    frame.classList.add("leaving");
    setTimeout(() => void api.closeSettings(), 170);
  } else {
    void api.closeSettings();
  }
}

/** Re-fetches the config from the backend and re-renders the form. */
async function reload(): Promise<void> {
  session.cfg = await api.getSettings();
  session.defaultDir = await api.defaultExportDir();
  session.saved = snapshot();
  render();
}

/** Entry point. */
export async function main(): Promise<void> {
  session.root = document.getElementById("settings-root") as HTMLDivElement;
  await reload();

  // Re-opening the window re-reads config.json so manual edits and changes
  // made elsewhere are always reflected.
  await listen("settings-shown", () => void reload());

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // During hotkey capture Esc is consumed by the capture listener.
    if (session.capturing) return;
    if (session.dismissModal) {
      session.dismissModal();
      return;
    }
    requestClose();
  });

  // Native window dragging from the title.
  document.addEventListener("pointerdown", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("button, input, label")) return;
    if (!t.closest("[data-drag]")) return;
    void getCurrentWindow().startDragging();
  });
}

main().catch((e) => console.error("settings init failed", e));
