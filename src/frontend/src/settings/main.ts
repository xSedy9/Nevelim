/**
 * Settings window entry point.
 *
 * Edits the local configuration (hotkey, AI provider, credentials, paste
 * behaviour) and saves it via the backend, which re-registers the global
 * hotkey. Black-and-white minimalist UI per the project design rules.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";

import { api, type AppConfig, type ProviderId } from "../shared/ipc";
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
  root: null as unknown as HTMLDivElement,
};

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
  b.innerHTML = `${iconName ? icon(iconName, 14) : ""}<span>${label}</span>`;
  return b;
}

/** Renders the whole settings form from `session.cfg`. */
function render(): void {
  const cfg = session.cfg!;
  session.root.innerHTML = "";
  const frame = el("div", "frame");

  const closeBtn = el("button", "icon-btn");
  closeBtn.innerHTML = icon("x", 14);
  closeBtn.title = "Закрыть (Esc)";
  closeBtn.addEventListener("click", close);
  frame.appendChild(closeBtn);

  const title = el("div", "title");
  title.setAttribute("data-drag", "");
  title.textContent = "Настройки";
  frame.appendChild(title);

  // Hotkey.
  sectionLabel(frame, "Горячая клавиша");
  const hotkeyInput = el("input", "input mono");
  hotkeyInput.value = cfg.hotkey;
  hotkeyInput.spellcheck = false;
  hotkeyInput.addEventListener("input", () => (cfg.hotkey = hotkeyInput.value.trim()));
  frame.appendChild(hotkeyInput);
  const hint = el("div", "hint");
  hint.textContent = "Пример: alt+shift+v";
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
  keyInput.addEventListener("input", () => (setKey(cfg, cfg.provider, keyInput.value)));
  frame.appendChild(keyInput);

  sectionLabel(frame, "Модель");
  const modelInput = el("input", "input mono");
  modelInput.value = modelOf(cfg, cfg.provider);
  modelInput.spellcheck = false;
  modelInput.addEventListener("input", () => (setModel(cfg, cfg.provider, modelInput.value)));
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
  swInput.addEventListener("change", () => (cfg.paste_automatically = swInput.checked));
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
  chooseDir.addEventListener("click", () => void pickExportDir(cfg, refreshDirLabel));
  const resetDir = btn("btn-ghost", "x", "Сбросить");
  resetDir.addEventListener("click", () => {
    cfg.export_dir = "";
    refreshDirLabel();
  });
  dirBtns.append(chooseDir, resetDir);
  dirRow.append(dirLabel, dirBtns);
  frame.appendChild(dirRow);

  // Footer with save button + status line.
  const foot = el("div", "foot");
  const err = el("div", "err mono");
  const save = el("button", "btn-primary");
  save.innerHTML = `${icon("check", 15)}<span>Сохранить</span>`;
  save.addEventListener("click", () => void saveFlow(save, err));
  foot.append(err, save);
  frame.appendChild(foot);

  session.root.appendChild(frame);
  requestAnimationFrame(() => frame.classList.add("shown"));
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
async function pickExportDir(cfg: AppConfig, refresh: () => void): Promise<void> {
  if (session.busy) return;
  session.busy = true;
  try {
    const folder = await api.pickFolder();
    if (folder) {
      cfg.export_dir = folder;
      refresh();
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

/** Persists the configuration; shows a success flash or an inline error. */
async function saveFlow(save: HTMLButtonElement, err: HTMLElement): Promise<void> {
  if (session.busy || !session.cfg) return;
  session.busy = true;
  const restore = setBusy(save, "Сохранение…");
  try {
    await api.saveSettings(session.cfg);
    save.innerHTML = `${icon("check", 15)}<span>Сохранено</span>`;
    err.textContent = "";
    setTimeout(() => {
      save.innerHTML = `${icon("check", 15)}<span>Сохранить</span>`;
    }, 1600);
  } catch (e) {
    err.textContent = String(e);
  } finally {
    restore();
    session.busy = false;
  }
}

/** Swaps a button's content to a spinner state. */
function setBusy(btnEl: HTMLButtonElement, label: string): () => void {
  const original = btnEl.innerHTML;
  btnEl.classList.add("loading");
  btnEl.innerHTML = `<span class="spinner"></span><span>${label}</span>`;
  return () => {
    btnEl.classList.remove("loading");
    btnEl.innerHTML = original;
  };
}

/** Closes the settings window. */
function close(): void {
  void api.closeSettings();
}

/** Entry point. */
export async function main(): Promise<void> {
  session.root = document.getElementById("settings-root") as HTMLDivElement;
  session.cfg = await api.getSettings();
  session.defaultDir = await api.defaultExportDir();
  render();

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !session.busy) close();
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
