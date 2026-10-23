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

/** Clears the content area and returns a fresh frame with the close button. */
function clear(): HTMLDivElement {
  session.root.innerHTML = "";
  const frame = el("div", "frame");
  const closeBtn = el("button", "icon-btn");
  closeBtn.innerHTML = icon("x", 14);
  closeBtn.title = "Закрыть (Esc)";
  closeBtn.addEventListener("click", () => close());
  frame.appendChild(closeBtn);
  session.root.appendChild(frame);
  return frame;
}

/** Adds a centered (draggable) prompt row with an optional leading icon. */
function promptRow(frame: HTMLDivElement, iconName: IconName | null, text: string): void {
  const p = el("div", "prompt");
  p.setAttribute("data-drag", "");
  p.innerHTML = `${iconName ? `<span class="p-ico">${icon(iconName, 15)}</span>` : ""}<span>${text}</span>`;
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

/** Renders phase 1: kicker + centered prompt + two hover-animated halves. */
function renderSelect(): void {
  session.phase = "select";
  const frame = clear();

  const kicker = el("div", "kicker");
  kicker.textContent = `Адаптация · ${session.init?.snippet_name ?? ""}`;
  kicker.setAttribute("data-drag", "");
  frame.appendChild(kicker);

  promptRow(frame, null, "Выберите источник");

  const row = el("div", "halves");
  const halves: Array<{ ic: IconName; title: string; sub: string; go: () => void }> = [
    { ic: "folder", title: "Папка проекта", sub: "Автопоиск в docs/ или корне", go: () => chooseFolder() },
    { ic: "file", title: "Файл спецификации", sub: "Прямой выбор .md, .txt, .json", go: () => chooseFile() },
  ];
  for (const h of halves) {
    const b = el("button", "half");
    b.innerHTML =
      `<span class="tile">${icon(h.ic, 22)}</span>` +
      `<span class="half-title">${h.title}</span>` +
      `<span class="half-sub">${h.sub}</span>`;
    b.addEventListener("click", h.go);
    row.appendChild(b);
  }
  frame.appendChild(row);
  requestAnimationFrame(() => frame.classList.add("shown"));
}

// ==========================================
// PHASE 2: FOLDER / FILE
// ==========================================

/** Enters the folder phase and auto-opens the directory picker. */
function chooseFolder(): void {
  if (session.busy) return;
  session.phase = "folder";
  const frame = clear();
  frame.classList.add("shown");
  promptRow(frame, "folder", "Папка проекта");

  const area = el("div", "area");
  const pick = btn("btn-dark", "folder", "Открыть диалог выбора");
  pick.addEventListener("click", () => void pickFolderFlow());
  const back = btn("btn-ghost", "arrow-left", "Назад");
  back.addEventListener("click", renderSelect);
  area.append(pick, back);
  frame.appendChild(area);

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

/** Enters the file phase with the drop zone. */
function chooseFile(): void {
  if (session.busy) return;
  session.phase = "file";
  const frame = clear();
  frame.classList.add("shown");
  promptRow(frame, "file", "Файл спецификации");

  const area = el("div", "area");
  const zone = el("div", "dropzone");
  zone.innerHTML =
    `<span class="dz-ico">${icon("file", 20)}</span>` +
    `<span class="dz-title">Перетащите файл или нажмите</span>` +
    `<span class="dz-sub">.md, .txt, .json, .yaml</span>`;
  zone.addEventListener("click", () => void pickFileFlow());
  const back = btn("btn-ghost", "arrow-left", "Назад");
  back.addEventListener("click", renderSelect);
  area.append(zone, back);
  frame.appendChild(area);
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

/** Renders the specification status card and the adapt action. */
function renderSpec(spec: SpecDto, isFolder: boolean): void {
  session.phase = "spec";
  session.specIsFolder = isFolder;
  const frame = clear();
  frame.classList.add("shown");
  promptRow(frame, isFolder ? "folder" : "file", isFolder ? "Папка проекта" : "Файл спецификации");

  const area = el("div", "area");

  const card = el("div", `spec ${spec.found ? "ok" : "bad"}`);
  const dot = el("span", `s-dot ${spec.found ? "ok" : "bad"}`);
  const body = el("div", "s-body");
  const title = el("div", "s-title");
  title.textContent = spec.found
    ? (spec.path ?? "").split(/[\\/]/).pop() || spec.path
    : "Ошибка";
  const sub = el("div", "s-sub mono");
  sub.textContent = spec.found
    ? `${(spec.content.length / 1024).toFixed(1)} КБ · готово к адаптации`
    : spec.error || "Неизвестная ошибка";
  body.append(title, sub);
  card.append(dot, body);
  area.appendChild(card);

  if (spec.found) {
    const adapt = btn("btn-primary", "sparkle", "Адаптировать");
    adapt.addEventListener("click", () => void adaptFlow(adapt));
    area.appendChild(adapt);
  } else {
    const retry = btn("btn-dark", isFolder ? "folder" : "file", "Повторить выбор");
    retry.addEventListener("click", () => (isFolder ? chooseFolder() : chooseFile()));
    area.appendChild(retry);
  }

  const back = btn("btn-ghost", "arrow-left", "Сменить источник");
  back.addEventListener("click", renderSelect);
  area.appendChild(back);
  frame.appendChild(area);
}

/** Runs the AI adaptation with a spinner, then shows the result phase. */
async function adaptFlow(adapt: HTMLButtonElement): Promise<void> {
  if (session.busy || !session.spec?.found) return;
  const spec = session.spec;
  session.busy = true;
  const restore = setBusy(adapt, "Адаптация…");
  try {
    const result = await api.adaptTemplate(spec.content, session.init?.snippet_content ?? "");
    session.chat = [];
    renderResult(result);
  } catch {
    adapt.innerHTML = `${icon("warning", 15)}<span>Ошибка</span>`;
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
  const frame = clear();
  frame.classList.add("shown");
  session.root.classList.remove("error");

  const head = el("div", "result-head");
  head.setAttribute("data-drag", "");
  const label = el("div", "result-label", "Адаптированный результат");
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
  input.placeholder = "Что изменить? Например: сделай короче, добавь типизацию…";
  const send = btn("btn-dark", "send", "Отправить");
  send.addEventListener("click", () => void refineFlow(input, send, ta));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void refineFlow(input, send, ta);
  });
  chat.append(input, send);
  frame.appendChild(chat);

  const footer = el("div", "footer");
  const accept = btn("btn-primary", "check", "Принять и вставить");
  accept.addEventListener("click", () => {
    const final = ta.value.trim();
    if (!final || !session.init) return;
    void api
      .saveHistory(session.init.snippet_name, final)
      .then(() => api.pasteSnippet(final))
      .then(close);
  });
  const copy = btn("btn-dark", "copy", "Скопировать");
  copy.addEventListener("click", () => {
    const final = ta.value.trim();
    if (!final || !session.init) return;
    void api
      .saveHistory(session.init.snippet_name, final)
      .then(() => api.copyText(final))
      .then(close);
  });
  const back = btn("btn-ghost", "arrow-left", "Сменить источник");
  back.addEventListener("click", renderSelect);
  footer.append(accept, copy, back);
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
  const restore = setBusy(send, "Думает…");
  session.chat.push({
    role: "user",
    content: `УТОЧНЕНИЕ: ${prompt}\n\nТЕКУЩИЙ ВАРИАНТ:\n${ta.value}`,
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
  frame.appendChild(el("div", "loading muted", "Загрузка…"));

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
