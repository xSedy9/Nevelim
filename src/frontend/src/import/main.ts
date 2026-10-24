/**
 * Import wizard entry point.
 *
 * Simple two-step flow: full-frame file drop zone -> quick validity check with
 * a green/red frame -> import into the templates directory.
 */

import { api, type ImportCheckDto } from "../shared/ipc";
import { icon } from "../shared/icons";

/** Runtime session. */
const session = {
  root: null as unknown as HTMLDivElement,
  file: null as string | null,
  busy: false,
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

/** Closes the wizard window. */
function close(): void {
  void api.closeImport();
}

/** Clears the content area and returns a fresh frame. */
function clear(): HTMLDivElement {
  session.root.classList.remove("ok", "bad");
  session.root.innerHTML = "";
  const frame = el("div", "frame");
  const title = el("div", "wiz-title", "Мастер импорта");
  const closeBtn = el("button", "icon-btn");
  closeBtn.innerHTML = icon("x", 14);
  closeBtn.title = "Закрыть (Esc)";
  closeBtn.addEventListener("click", close);
  frame.append(title, closeBtn);
  session.root.appendChild(frame);
  return frame;
}

/** Renders the full-frame drop zone (phase 1). */
function renderPick(): void {
  session.file = null;
  const frame = clear();
  frame.classList.add("shown");

  const zone = el("div", "dz");
  zone.innerHTML =
    `<span class="dz-ico">${icon("file", 26)}</span>` +
    `<span class="dz-title">Выберите архив экспорта</span>` +
    `<span class="dz-sub">.zip — восстановит шаблоны и настройки</span>`;
  zone.addEventListener("click", () => void pickFlow());
  frame.appendChild(zone);
  requestAnimationFrame(() => frame.classList.add("shown"));
}

/** File dialog -> quick validation -> status view. */
async function pickFlow(): Promise<void> {
  if (session.busy) return;
  session.busy = true;
  try {
    const file = await api.pickImportFile();
    if (!file) return;
    const check = await api.checkImportFile(file);
    if (check.ok) session.file = file;
    renderCheck(check);
  } finally {
    session.busy = false;
  }
}

/** Renders the validation status: icon + name + size, import action.
 * Clicking the file card reopens the picker dialog. */
function renderCheck(check: ImportCheckDto): void {
  const frame = clear();
  frame.classList.add("shown");
  session.root.classList.add(check.ok ? "ok" : "bad");

  const stage = el("div", "stage");
  stage.title = "Выбрать другой архив";
  const inner = el("div", "stage-inner");
  const ico = el("div", "stage-ico");
  ico.innerHTML = icon(check.ok ? "check" : "warning", 28);
  const meta = el("div", "stage-meta");
  const name = el("div", "s-name");
  name.textContent = check.ok ? `${check.name}.zip` : check.error || "Ошибка";
  const size = el("div", "s-size");
  size.textContent = check.ok
    ? `${(check.size_bytes / 1024).toFixed(1)} КБ · готов к импорту`
    : "Нажмите, чтобы выбрать другой архив";
  meta.append(name, size);
  inner.append(ico, meta);
  stage.appendChild(inner);
  stage.addEventListener("click", () => void pickFlow());
  frame.appendChild(stage);

  if (check.ok) {
    const area = el("div", "area");
    const imp = el("button", "btn btn-primary");
    imp.innerHTML = `${icon("check", 15)}<span>Импортировать</span>`;
    imp.addEventListener("click", () => void importFlow(imp));
    area.appendChild(imp);
    frame.appendChild(area);
  }
}

/** Imports the validated file and closes the wizard. */
async function importFlow(imp: HTMLButtonElement): Promise<void> {
  if (session.busy || !session.file) return;
  session.busy = true;
  const restore = setBusy(imp, "Импорт…");
  try {
    await api.importTemplate(session.file);
    close();
  } catch (e) {
    console.error("import failed:", e);
    renderPick();
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

/** Entry point. */
export async function main(): Promise<void> {
  session.root = document.getElementById("import-root") as HTMLDivElement;
  renderPick();

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !session.busy) close();
  });
}

main().catch((e) => console.error("import init failed", e));
