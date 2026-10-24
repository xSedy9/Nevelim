/**
 * Adaptation modal entry point.
 *
 * Modern dark UI driven by inline SVG icons: phase 1 - source selection,
 * phase 2 - folder/file pickers, phase 3 - editable AI result with a
 * refinement chat. The frame is natively draggable via `startDragging`.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";

import { api, type ChatMessage, type ModalInit, type SpecDto } from "../shared/ipc";
import { icon, type IconName } from "./icons";

/** Modal phases. */
type Phase = "select" | "folder" | "file" | "spec" | "result";

/** Runtime session state. */
interface Session {
  init: ModalInit | null;
  phase: Phase;
  spec: SpecDto | null;
  specIsFolder: boolean;
  chat: ChatMessage[];
  busy: boolean;
  root: HTMLDivElement;
}

const session: Session = {
  init: null,
  phase: "select",
  spec: null,
  specIsFolder: false,
  chat: [],
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

/** Builds a button with an optional leading SVG icon and a text label. */
function btn(cls: string, iconName: IconName | null, label: string): HTMLButtonElement {
  const b = el("button", `btn ${cls}`);
  b.innerHTML = `${iconName ? icon(iconName, 15) : ""}<span>${label}</span>`;
  return b;
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

/** Clears the content area and returns a fresh frame.
 *
 * Always carries the close (top-right) button; pass a `back` handler to also
 * get an icon-only back button (top-left).
 */
function clear(back?: () => void): HTMLDivElement {
  session.root.innerHTML = "";
  const frame = el("div", "frame");
  if (back) {
    const backBtn = el("button", "icon-btn left");
    backBtn.innerHTML = icon("arrow-left", 14);
    backBtn.title = "РќР°Р·Р°Рґ";
    backBtn.addEventListener("click", back);
    frame.appendChild(backBtn);
  }
  const closeBtn = el("button", "icon-btn");
  closeBtn.innerHTML = icon("x", 14);
  closeBtn.title = "Р—Р°РєСЂС‹С‚СЊ (Esc)";
  closeBtn.addEventListener("click", () => close());
  frame.appendChild(closeBtn);
  session.root.appendChild(frame);
  return frame;
}

/** Adds a centered prompt row in the top strip (aligned with the nav buttons). */
function promptStrip(frame: HTMLDivElement, text: string): void {
  const p = el("div", "prompt strip");
  p.setAttribute("data-drag", "");
  p.textContent = text;
  frame.appendChild(p);
}

/** Applies the red error border state for 3.5 s. */
async function errorBorder(): Promise<void> {
  session.root.classList.add("error");
  await new Promise((r) => setTimeout(r, 3500));
  session.root.classList.remove("error");
}

/** Closes the modal window. */
function close(): void {
  void api.closeModal();
}

// ==========================================
// PHASE 1: SOURCE SELECTION
// ==========================================

/** Renders phase 1: centered prompt + two hover-animated halves. */
function renderSelect(): void {
  session.phase = "select";
  const frame = clear();

  promptStrip(frame, "Р’С‹Р±РµСЂРёС‚Рµ РёСЃС‚РѕС‡РЅРёРє");

  const row = el("div", "halves");
  const halves: Array<{ ic: IconName; go: () => void }> = [
    { ic: "folder", go: () => chooseFolder() },
    { ic: "file", go: () => chooseFile() },
  ];
  for (const h of halves) {
    const b = el("button", "half");
    b.title = h.ic === "folder" ? "РџР°РїРєР° РїСЂРѕРµРєС‚Р°" : "Р¤Р°Р№Р» СЃРїРµС†РёС„РёРєР°С†РёРё";
    b.innerHTML = icon(h.ic, 46);
    b.addEventListener("click", h.go);
    row.appendChild(b);
  }
  frame.appendChild(row);
  requestAnimationFrame(() => frame.classList.add("shown"));
}

// ==========================================
// PHASE 2: FOLDER / FILE
// ==========================================

/** Enters the folder phase: full-frame drop zone, dialog opens automatically. */
function chooseFolder(): void {
  if (session.busy) return;
  session.phase = "folder";
  const frame = clear(renderSelect);
  frame.classList.add("shown");

  const zone = el("div", "dropzone full");
  zone.innerHTML =
    `<span class="dz-ico">${icon("folder", 26)}</span>` +
    `<span class="dz-title">Р’С‹Р±РµСЂРёС‚Рµ РїР°РїРєСѓ РїСЂРѕРµРєС‚Р°</span>` +
    `<span class="dz-sub">РґРёР°Р»РѕРі РѕС‚РєСЂРѕРµС‚СЃСЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё</span>`;
  zone.addEventListener("click", () => void pickFolderFlow());
  frame.appendChild(zone);

  setTimeout(() => void pickFolderFlow(), 180);
}

/** Folder flow: dialog -> spec lookup -> status card. */
async function pickFolderFlow(): Promise<void> {
  if (session.busy) return;
  session.busy = true;
  try {
    const folder = await api.pickFolder();
    if (!folder) return;
    const spec = await api.loadSpecFromFolder(folder);
    session.spec = spec;
    renderSpec(spec, true);
  } finally {
    session.busy = false;
  }
}

/** Enters the file phase: full-frame drop zone. */
function chooseFile(): void {
  if (session.busy) return;
  session.phase = "file";
  const frame = clear(renderSelect);
  frame.classList.add("shown");

  const zone = el("div", "dropzone full");
  zone.innerHTML =
    `<span class="dz-ico">${icon("file", 26)}</span>` +
    `<span class="dz-title">Р’С‹Р±РµСЂРёС‚Рµ С„Р°Р№Р» СЃРїРµС†РёС„РёРєР°С†РёРё</span>` +
    `<span class="dz-sub">.md, .txt, .json, .yaml</span>`;
  zone.addEventListener("click", () => void pickFileFlow());
  frame.appendChild(zone);
}

/** File flow: dialog -> validation -> status card. */
async function pickFileFlow(): Promise<void> {
  if (session.busy) return;
  session.busy = true;
  try {
    const file = await api.pickFile();
    if (!file) return;
    const spec = await api.loadSpecFromFile(file);
    session.spec = spec;
    renderSpec(spec, false);
  } finally {
    session.busy = false;
  }
}

// ==========================================
// SPEC STATUS + ADAPT
// ==========================================

/** Renders the specification status: just the source icon, then the action. */
function renderSpec(spec: SpecDto, isFolder: boolean): void {
  session.phase = "spec";
  session.specIsFolder = isFolder;
  const frame = clear(renderSelect);
  frame.classList.add("shown");
  if (!spec.found) session.root.classList.add("error");

  // The source itself: a single large icon, green-tinted on success,
  // red-tinted on failure (no text per design).
  const stage = el("div", "stage");
  const tile = el("div", `big-tile ${spec.found ? "ok" : "bad"}`);
  tile.innerHTML = icon(isFolder ? "folder" : "file", 36);
  stage.appendChild(tile);
  frame.appendChild(stage);

  const area = el("div", "area");
  if (spec.found) {
    const adapt = btn("btn-primary", "sparkle", "РђРґР°РїС‚РёСЂРѕРІР°С‚СЊ");
    adapt.addEventListener("click", () => void adaptFlow(adapt));
    area.appendChild(adapt);
  } else {
    const retry = btn("btn-dark", isFolder ? "folder" : "file", "РџРѕРІС‚РѕСЂРёС‚СЊ РІС‹Р±РѕСЂ");
    retry.addEventListener("click", () => (isFolder ? chooseFolder() : chooseFile()));
    area.appendChild(retry);
  }
  frame.appendChild(area);
}

/** Runs the AI adaptation with a spinner, then shows the result phase. */
async function adaptFlow(adapt: HTMLButtonElement): Promise<void> {
  if (session.busy || !session.spec?.found) return;
  const spec = session.spec;
  session.busy = true;
  const restore = setBusy(adapt, "РђРґР°РїС‚Р°С†РёСЏвЂ¦");
  try {
    const result = await api.adaptTemplate(spec.content, session.init?.snippet_content ?? "");
    session.chat = [];
    renderResult(result);
  } catch {
    adapt.innerHTML = `${icon("warning", 15)}<span>РћС€РёР±РєР°</span>`;
    session.root.classList.add("error");
    await errorBorder();
    renderSpec(spec, session.specIsFolder);
  } finally {
    restore();
    session.busy = false;
  }
}

// ==========================================
// PHASE 3: RESULT + REFINEMENT
// ==========================================

/** Renders the editable result with the refinement chat bar and actions. */
function renderResult(text: string): void {
  session.phase = "result";
  const frame = clear(renderSelect);
  frame.classList.add("shown");
  session.root.classList.remove("error");

  const head = el("div", "result-head");
  head.setAttribute("data-drag", "");
  const label = el("div", "result-label", "РђРґР°РїС‚РёСЂРѕРІР°РЅРЅС‹Р№ СЂРµР·СѓР»СЊС‚Р°С‚");
  const chip = el("span", "chip mono");
  chip.innerHTML = `${icon("zap", 11)}<span>${session.init?.snippet_name ?? ""}</span>`;
  head.append(label, chip);
  frame.appendChild(head);

  const ta = document.createElement("textarea");
  ta.className = "result";
  ta.value = text;
  ta.spellcheck = false;
  frame.appendChild(ta);

  const chat = el("div", "chat");
  const input = document.createElement("input");
  input.className = "chat-input";
  input.placeholder = "Р§С‚Рѕ РёР·РјРµРЅРёС‚СЊ? РќР°РїСЂРёРјРµСЂ: СЃРґРµР»Р°Р№ РєРѕСЂРѕС‡Рµ, РґРѕР±Р°РІСЊ С‚РёРїРёР·Р°С†РёСЋвЂ¦";
  const send = btn("btn-dark", "send", "РћС‚РїСЂР°РІРёС‚СЊ");
  send.addEventListener("click", () => void refineFlow(input, send, ta));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void refineFlow(input, send, ta);
  });
  chat.append(input, send);
  frame.appendChild(chat);

  const footer = el("div", "footer");
  const accept = btn("btn-primary", "check", "РџСЂРёРЅСЏС‚СЊ Рё РІСЃС‚Р°РІРёС‚СЊ");
  accept.addEventListener("click", () => {
    const final = ta.value.trim();
    if (!final || !session.init) return;
    void api
      .saveHistory(session.init.snippet_name, final)
      .then(() => api.pasteSnippet(final))
      .then(close);
  });
  const copy = btn("btn-dark", "copy", "РЎРєРѕРїРёСЂРѕРІР°С‚СЊ");
  copy.addEventListener("click", () => {
    const final = ta.value.trim();
    if (!final || !session.init) return;
    void api
      .saveHistory(session.init.snippet_name, final)
      .then(() => api.copyText(final))
      .then(close);
  });
  footer.append(accept, copy);
  frame.appendChild(footer);
}

/** Sends the refinement prompt and swaps the result text. */
async function refineFlow(
  input: HTMLInputElement,
  send: HTMLButtonElement,
  ta: HTMLTextAreaElement,
): Promise<void> {
  const prompt = input.value.trim();
  const spec = session.spec;
  if (!prompt || session.busy || !spec?.found) return;
  session.busy = true;
  const restore = setBusy(send, "Р”СѓРјР°РµС‚вЂ¦");
  session.chat.push({
    role: "user",
    content: `РЈРўРћР§РќР•РќРР•: ${prompt}\n\nРўР•РљРЈР©РР™ Р’РђР РРђРќРў:\n${ta.value}`,
  });
  try {
    const res = await api.refineResult(session.chat);
    session.chat.push({ role: "assistant", content: res });
    ta.value = res;
    input.value = "";
  } catch {
    session.root.classList.add("error");
    await errorBorder();
  } finally {
    restore();
    session.busy = false;
  }
}

// ==========================================
// ENTRY POINT
// ==========================================

/** Entry point: loads the payload, builds phase 1, wires global handlers. */
export async function main(): Promise<void> {
  session.root = document.getElementById("modal-root") as HTMLDivElement;
  const frame = clear();
  frame.appendChild(el("div", "loading muted", "Р—Р°РіСЂСѓР·РєР°вЂ¦"));

  session.init = await api.getModalInit();
  if (!session.init) {
    close();
    return;
  }

  renderSelect();

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !session.busy) close();
  });

  // Native window dragging from designated (non-interactive) areas.
  document.addEventListener("pointerdown", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("button, input, textarea")) return;
    if (!t.closest("[data-drag]")) return;
    void getCurrentWindow().startDragging();
  });
}

main().catch((e) => console.error("modal init failed", e));
