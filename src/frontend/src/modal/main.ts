/**
 * Adaptation modal entry point.
 *
 * Modern dark UI driven by inline SVG icons: phase 1 - source selection,
 * phase 2 - folder/file pickers, phase 3 - editable AI result with a
 * refinement chat. The frame is natively draggable via `startDragging`.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";

import { api, type ChatMessage, type ModalInit, type SpecDto } from "../shared/ipc";
import { formatSize } from "../shared/format";
import { icon, type IconName } from "../shared/icons";

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
  closing: boolean;
  root: HTMLDivElement;
}

const session: Session = {
  init: null,
  phase: "select",
  spec: null,
  specIsFolder: false,
  chat: [],
  busy: false,
  closing: false,
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
 * The previous frame plays a quick exit animation instead of vanishing.
 * Always carries the close (top-right) button; pass a `back` handler to also
 * get an icon-only back button (top-left). Resets status classes.
 */
function clear(back?: () => void): HTMLDivElement {
  const old = session.root.querySelector(".frame");
  if (old) {
    old.classList.add("leaving");
    setTimeout(() => old.remove(), 180);
  }
  session.root.querySelectorAll(".mini-overlay").forEach((o) => o.remove());
  session.root.classList.remove("error", "ok");
  const frame = el("div", "frame");
  if (back) {
    const backBtn = el("button", "icon-btn left");
    backBtn.innerHTML = icon("arrow-left", 14);
    backBtn.title = "Назад";
    backBtn.addEventListener("click", back);
    frame.appendChild(backBtn);
  }
  const closeBtn = el("button", "icon-btn");
  closeBtn.innerHTML = icon("x", 14);
  closeBtn.title = "Закрыть (Esc)";
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

/** Closes the modal window with the exit animation. */
function close(): void {
  if (session.closing) return;
  session.closing = true;
  const frame = session.root.querySelector(".frame");
  if (frame) {
    frame.classList.add("leaving");
    setTimeout(() => void api.closeModal(), 170);
  } else {
    void api.closeModal();
  }
}

// ==========================================
// PHASE 1: SOURCE SELECTION
// ==========================================

/** Renders phase 1: centered prompt + two hover-animated halves. */
function renderSelect(): void {
  session.phase = "select";
  const frame = clear();

  promptStrip(frame, "Выберите источник");

  const row = el("div", "halves");
  const halves: Array<{ ic: IconName; go: () => void }> = [
    { ic: "folder", go: () => chooseFolder() },
    { ic: "file", go: () => chooseFile() },
  ];
  for (const h of halves) {
    const b = el("button", "half");
    b.title = h.ic === "folder" ? "Папка проекта" : "Файл спецификации";
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
    `<span class="dz-title">Выберите папку проекта</span>` +
    `<span class="dz-sub">Автопоиск в docs/ или корне проекта:</span>` +
    `<span class="dz-files mono">SPECIFICATION.md · spec.md · SPEC.md · README.md · *.md</span>`;
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
    `<span class="dz-title">Выберите файл спецификации</span>` +
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

/** Renders the specification status: full-space panel (icon + name + size),
 * action pinned to the bottom. `errorMessage` adds a persistent red note and
 * keeps the frame border red. */
function renderSpec(spec: SpecDto, isFolder: boolean, errorMessage?: string): void {
  session.phase = "spec";
  session.specIsFolder = isFolder;
  const frame = clear(renderSelect);
  frame.classList.add("shown");
  session.root.classList.remove("ok");
  const failed = !spec.found || errorMessage !== undefined;
  if (failed) {
    session.root.classList.add("error");
    const err = el("div", "err-line");
    err.textContent = errorMessage ?? spec.error ?? "Неизвестная ошибка";
    frame.appendChild(err);
  } else {
    session.root.classList.add("ok");
  }

  // Full-space status panel: icon centered, file name and size beside it.
  const stage = el("div", "stage");
  const inner = el("div", "stage-inner");
  const ico = el("div", "stage-ico");
  ico.innerHTML = icon(isFolder ? "folder" : "file", 34);
  const meta = el("div", "stage-meta");
  const name = el("div", "s-name");
  name.textContent = spec.found
    ? (spec.path ?? "").split(/[\\/]/).pop() || (isFolder ? "Папка проекта" : "Спецификация")
    : isFolder
      ? "Папка проекта"
      : "Файл спецификации";
  const size = el("div", "s-size mono");
  size.textContent = formatSize(spec.size_bytes);
  meta.append(name, size);
  inner.append(ico, meta);
  stage.appendChild(inner);
  frame.appendChild(stage);

  const area = el("div", "area");
  if (spec.found) {
    const adapt = btn("btn-primary", "sparkle", "Адаптировать");
    adapt.addEventListener("click", () => void adaptFlow(adapt));
    area.appendChild(adapt);
  } else {
    const retry = btn("btn-dark", isFolder ? "folder" : "file", "Повторить выбор");
    retry.addEventListener("click", () => (isFolder ? chooseFolder() : chooseFile()));
    area.appendChild(retry);
  }
  frame.appendChild(area);
}

/** Normalizes an AI call failure into a user-facing message. */
function aiErrorText(e: unknown): string {
  const raw = String(e);
  if (/api[-_ ]?key|unauthorized|401|403/i.test(raw)) {
    return "Проверьте API-ключ в config.json или доступность провайдера.";
  }
  if (/timed out|timeout/i.test(raw)) {
    return "Таймаут ответа нейросети. Попробуйте ещё раз.";
  }
  return raw;
}

/** Shows a modal-in-modal error card: warning icon left, "Ошибка" title with
 * the message text beside it, OK button at the bottom right.
 * Dismissed by the OK button or a backdrop click; plays a fade-out exit. */
function showErrorModal(message: string): void {
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

  let closing = false;
  const dismiss = () => {
    if (closing) return;
    closing = true;
    overlay.classList.add("leaving");
    setTimeout(() => {
      overlay.remove();
      session.root.classList.remove("error");
    }, 180);
  };
  ok.addEventListener("click", dismiss);
  overlay.addEventListener("pointerdown", (e) => {
    if (e.target === overlay) dismiss();
  });

  session.root.appendChild(overlay);
  // Keyboard-first: Enter confirms the dialog right away.
  ok.focus();
}

/** Runs the AI adaptation with a spinner, then shows the result phase.
 *
 * On failure re-renders the clean spec view and raises an error mini-modal.
 */
async function adaptFlow(adapt: HTMLButtonElement): Promise<void> {
  if (session.busy || !session.spec?.found) return;
  const spec = session.spec;
  session.busy = true;
  const restore = setBusy(adapt, "Адаптация…");
  try {
    const result = await api.adaptTemplate(spec.content, session.init?.snippet_content ?? "");
    session.chat = [];
    renderResult(result);
  } catch (e) {
    console.error("adapt failed:", e);
    renderSpec(spec, session.specIsFolder);
    showErrorModal(aiErrorText(e));
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
  } catch (e) {
    console.error("refine failed:", e);
    showErrorModal(aiErrorText(e));
  } finally {
    restore();
    session.busy = false;
  }
}

// ==========================================
// ENTRY POINT
// ==========================================

/** Collects visible interactive controls for keyboard navigation. */
function focusables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("button, input, textarea")).filter(
    (n) => {
      const disabled = (n as HTMLButtonElement).disabled;
      return !disabled && n.offsetParent !== null;
    },
  );
}

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
    if (e.key === "Escape") {
      if (!session.busy) close();
      return;
    }
    // Arrow keys cycle focus between buttons/controls (Enter/Space then
    // activate them natively; Tab cycles as usual). Text fields keep the
    // arrows for caret movement.
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const tag = (document.activeElement?.tagName ?? "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    const items = focusables();
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
    const next = idx === -1 ? 0 : (idx + step + items.length) % items.length;
    items[next].focus();
    e.preventDefault();
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
