/**
 * Adaptation modal entry point: source selection (phase 1), folder/file
 * handling (phase 2) and the AI result with refinement chat (phase 3).
 */

import { listen } from "@tauri-apps/api/event";

import { api, type ChatMessage, type ModalInit, type SpecDto } from "../shared/ipc";

/** Modal phases. */
type Phase = "select" | "folder" | "file" | "spec" | "result";

/** Runtime session. */
const session = {
  init: null as ModalInit | null,
  phase: "select" as Phase,
  spec: null as SpecDto | null,
  specIsFolder: false,
  chat: [] as ChatMessage[],
  busy: false,
  root: null as unknown as HTMLDivElement,
};

/** Short helpers. */
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

/** Clears the content area and returns it. */
function clear(): HTMLDivElement {
  session.root.innerHTML = "";
  const frame = el("div", "frame");
  session.root.appendChild(frame);
  return frame;
}

/** Applies the red error border state for 3.5 s. */
async function errorBorder(): Promise<void> {
  session.root.classList.add("error");
  await new Promise((r) => setTimeout(r, 3500));
  session.root.classList.remove("error");
}

/** Closes the modal. */
function close(): void {
  void api.closeModal();
}

/** Renders phase 1: centered prompt + two animated icon halves. */
function renderSelect(): void {
  session.phase = "select";
  const frame = clear();

  const prompt = el("div", "prompt", "Выберите источник");
  frame.appendChild(prompt);

  const row = el("div", "halves");
  const left = el("div", "half hit2");
  left.innerHTML = `<div class="big-ico">📁</div><div class="cap">Папка проекта</div>`;
  const right = el("div", "half hit2");
  right.innerHTML = `<div class="big-ico">📄</div><div class="cap">Файл спецификации</div>`;
  row.append(left, right);
  frame.appendChild(row);

  left.addEventListener("click", () => chooseFolder());
  right.addEventListener("click", () => chooseFile());
  requestAnimationFrame(() => frame.classList.add("shown"));
}

/** Smoothly enters phase 2 (folder) and auto-opens the directory picker. */
function chooseFolder(): void {
  if (session.busy) return;
  session.phase = "folder";
  const frame = clear();
  frame.classList.add("shown");
  frame.appendChild(el("div", "prompt", "📁 Папка проекта"));
  const area = el("div", "area");
  const btn = el("button", "pill dark", "📂 Открыть диалог выбора");
  btn.addEventListener("click", () => void pickFolderFlow());
  const back = el("button", "pill ghost", "← Назад");
  back.addEventListener("click", renderSelect);
  area.append(btn, back);
  frame.appendChild(area);
  setTimeout(() => void pickFolderFlow(), 180);
}

/** Folder picker flow: dialog -> spec lookup -> spec card. */
async function pickFolderFlow(): Promise<void> {
  if (session.busy) return;
  session.busy = true;
  try {
    const folder = await api.pickFolder();
    if (!folder) return; // canceled -> stay in the folder phase
    const spec = await api.loadSpecFromFolder(folder);
    session.spec = spec;
    renderSpec(spec, true);
  } finally {
    session.busy = false;
  }
}

/** Smoothly enters phase 2 (file) with the drop zone. */
function chooseFile(): void {
  if (session.busy) return;
  session.phase = "file";
  const frame = clear();
  frame.classList.add("shown");
  frame.appendChild(el("div", "prompt", "📄 Файл спецификации"));
  const area = el("div", "area");
  const zone = el("div", "dropzone hit2");
  zone.innerHTML = `<div class="mid-ico">📂</div><div class="dz-title">Drag &amp; drop or select</div><div class="dz-sub">Нажмите для выбора файла (.md, .txt, .json)</div>`;
  zone.addEventListener("click", () => void pickFileFlow());
  const back = el("button", "pill ghost", "← Назад");
  back.addEventListener("click", renderSelect);
  area.append(zone, back);
  frame.appendChild(area);
}

/** File picker flow: dialog -> validation -> spec card. */
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

/** Renders the spec status card with the adapt action (or error + retry). */
function renderSpec(spec: SpecDto, isFolder: boolean): void {
  session.phase = "spec";
  session.specIsFolder = isFolder;
  const frame = clear();
  frame.classList.add("shown");
  frame.appendChild(el("div", "prompt", isFolder ? "📁 Папка проекта" : "📄 Файл спецификации"));
  const area = el("div", "area");

  const card = el("div", spec.found ? "spec ok" : "spec bad");
  const title = el("div", "spec-title");
  title.textContent = spec.found
    ? (spec.path ?? "").split(/[\\/]/).pop() || spec.path
    : "Ошибка";
  const sub = el("div", "spec-sub mono");
  sub.textContent = spec.found
    ? `${(spec.content.length / 1024).toFixed(1)} КБ · ✓ Файл спецификации подходит`
    : (spec.error ?? "Неизвестная ошибка");
  card.append(title, sub);
  area.appendChild(card);

  if (spec.found) {
    const adapt = el("button", "pill primary", "🚀 Адаптировать");
    adapt.addEventListener("click", () => void adaptFlow(adapt));
    area.appendChild(adapt);
  } else {
    session.root.classList.add("error");
    const retry = el("button", "pill dark", "Повторить выбор");
    retry.addEventListener("click", () => {
      session.root.classList.remove("error");
      if (isFolder) chooseFolder();
      else chooseFile();
    });
    area.appendChild(retry);
  }

  const back = el("button", "pill ghost", "← Сменить источник");
  back.addEventListener("click", () => {
    session.root.classList.remove("error");
    renderSelect();
  });
  area.appendChild(back);
  frame.appendChild(area);
}

/** Runs the AI adaptation with a spinner, then shows the result phase. */
async function adaptFlow(button: HTMLElement): Promise<void> {
  if (session.busy || !session.spec?.found) return;
  session.busy = true;
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const spin = setInterval(() => {
    button.textContent = `${frames[i++ % frames.length]} Адаптация нейросетью...`;
  }, 80);
  button.classList.add("disabled");

  try {
    const result = await api.adaptTemplate(session.spec.content, session.init?.snippet_content ?? "");
    session.chat = [];
    renderResult(result);
  } catch {
    button.textContent = "✕ Ошибка";
    session.root.classList.add("error");
    await errorBorder();
    renderSpec(session.spec, session.specIsFolder);
    button.textContent = "🚀 Адаптировать";
  } finally {
    clearInterval(spin);
    button.classList.remove("disabled");
    session.busy = false;
  }
}

/** Renders phase 3: editable result + refinement chat + actions. */
function renderResult(text: string): void {
  session.phase = "result";
  const frame = clear();
  frame.classList.add("shown");
  session.root.classList.remove("error");

  const head = el("div", "result-head");
  const label = el("div", "result-label", "2. Адаптированный результат (можно редактировать):");
  const tag = el("div", "mono muted", `⚡ ${session.init?.snippet_name ?? ""}`);
  head.append(label, tag);
  frame.appendChild(head);

  const ta = document.createElement("textarea");
  ta.className = "result";
  ta.value = text;
  ta.spellcheck = false;
  frame.appendChild(ta);

  const chat = el("div", "chat");
  const input = document.createElement("input");
  input.className = "chat-input";
  input.placeholder = "💬 Что изменить? (например: сделай короче, добавь типизацию...)";
  input.addEventListener("focus", () => {
    if (input.value.startsWith("💬")) input.value = "";
  });
  const send = el("button", "pill dark", "Отправить");
  send.addEventListener("click", () => void refineFlow(input, send, ta));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void refineFlow(input, send, ta);
  });
  chat.append(input, send);
  frame.appendChild(chat);

  const footer = el("div", "footer");
  const accept = el("button", "pill primary", "✓ Принять и Вставить");
  accept.addEventListener("click", () => {
    const final = ta.value.trim();
    if (!final || !session.init) return;
    void api.saveHistory(session.init.snippet_name, final).then(() => api.pasteSnippet(final)).then(close);
  });
  const copy = el("button", "pill dark", "📋 Скопировать");
  copy.addEventListener("click", () => {
    const final = ta.value.trim();
    if (!final || !session.init) return;
    void api.saveHistory(session.init.snippet_name, final).then(() => api.copyText(final)).then(close);
  });
  const back = el("button", "pill ghost", "← Сменить источник");
  back.addEventListener("click", renderSelect);
  footer.append(accept, copy, back);
  frame.appendChild(footer);
}

/** Sends the refinement prompt and swaps the result text. */
async function refineFlow(input: HTMLInputElement, send: HTMLElement, ta: HTMLTextAreaElement): Promise<void> {
  const prompt = input.value.trim();
  if (!prompt || prompt.startsWith("💬") || session.busy) return;
  session.busy = true;
  send.classList.add("disabled");
  send.textContent = "⠋ Думает...";
  session.chat.push({ role: "user", content: `УТОЧНЕНИЕ: ${prompt}\n\nТЕКУЩИЙ ВАРИАНТ:\n${ta.value}` });
  try {
    const res = await api.refineResult(session.chat);
    session.chat.push({ role: "assistant", content: res });
    ta.value = res;
    input.value = "";
  } catch {
    send.textContent = "✕ Ошибка";
    session.root.classList.add("error");
    await errorBorder();
    renderSpec(session.spec, session.specIsFolder);
  } finally {
    send.classList.remove("disabled");
    if (send.textContent?.includes("Думает")) send.textContent = "Отправить";
    session.busy = false;
  }
}

/** Entry point. */
export async function main(): Promise<void> {
  session.root = document.getElementById("modal-root") as HTMLDivElement;
  const frame = clear();
  frame.appendChild(el("div", "prompt muted", "Загрузка..."));

  session.init = await api.getModalInit();
  if (!session.init) {
    // No payload (e.g. hot reload) - nothing to adapt, close silently.
    close();
    return;
  }

  renderSelect();
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  await listen("tauri://blur", () => {
    /* keep open: the modal is a standalone window */
  });
}

main().catch((e) => console.error("modal init failed", e));
