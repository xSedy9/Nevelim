/**
 * DOM/SVG rendering of the overlay.
 *
 * Builds the full canvas (hub, snippet pills, connector lines, brackets,
 * action pills) once and then only updates positions/classes per model change,
 * letting CSS transitions handle the motion.
 */

import {
  ACTION,
  CANVAS,
  HUB,
  SETTINGS,
  SNIPPET,
  actionConnectorPath,
  actionY,
  bracketPath,
  connectorPath,
  settingsConnectorPath,
  slotY,
  sparklePath,
} from "./geometry";
import type { OverlayModel } from "./state";
import { icon } from "../shared/icons";

/** Action descriptors (mirrors the legacy action list). */
export const ACTIONS: Array<{ label: string; key: string }> = [
  { label: "Скопировать", key: "copy" },
  { label: "Вставить", key: "paste" },
  { label: "Изменить", key: "edit" },
  { label: "Адаптировать", key: "adapt" },
];

/** Everything the render layer needs about one snippet. */
export interface SnippetInfo {
  /** Display name. */
  name: string;
  /** Absolute path. */
  path: string;
  /** Content. */
  content: string;
}

/** Truncates long names with an ellipsis (legacy behaviour). */
export function truncate(name: string, max = 26): string {
  return name.length <= max ? name : name.slice(0, max - 1) + "…";
}

/** SVG namespace helper. */
function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Interactive overlay structure. */
export interface OverlayDom {
  /** Root container. */
  root: HTMLDivElement;
  /** SVG layer holding lines/brackets. */
  svg: SVGSVGElement;
  /** Hub element. */
  hub: HTMLDivElement;
  /** Collapsing energy ring shown during the suck-in close. */
  ring: HTMLDivElement;
  /** Per-template pill and connector elements. */
  pills: Array<{
    pill: HTMLDivElement;
    line: SVGPathElement;
    dot: SVGCircleElement;
  }>;
  /** Bracket paths (top, bottom). */
  brackets: [SVGPathElement, SVGPathElement];
  /** Per-action pill and connector elements. */
  actionPills: Array<{
    pill: HTMLDivElement;
    line: SVGPathElement;
    dot: SVGCircleElement;
  }>;
  /** Settings entry pill and connector (Left arrow from the hub). */
  settingsPill: {
    pill: HTMLDivElement;
    line: SVGPathElement;
    dot: SVGCircleElement;
  };
}

/** Builds the static overlay DOM for the given templates. */
export function buildOverlay(root: HTMLDivElement, templates: SnippetInfo[]): OverlayDom {
  root.innerHTML = "";
  root.style.width = `${CANVAS.width}px`;
  root.style.height = `${CANVAS.height}px`;

  const svg = svgEl("svg", {
    width: CANVAS.width,
    height: CANVAS.height,
    viewBox: `0 0 ${CANVAS.width} ${CANVAS.height}`,
    class: "lines",
  }) as SVGSVGElement;
  root.appendChild(svg);

  // Hub with the sparkle emblem.
  const hub = document.createElement("div");
  hub.className = "hub hit";
  hub.innerHTML = `
    <svg width="${HUB.r * 2 + 16}" height="${HUB.r * 2 + 16}" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="29" fill="rgba(0,0,0,0.95)" stroke="#fff" stroke-width="3"/>
      <path d="${sparklePath(32, 32, 18.5)}" fill="#fff"/>
    </svg>`;
  root.appendChild(hub);
  hub.style.left = `${HUB.x - HUB.r - 8}px`;
  hub.style.top = `${HUB.y - HUB.r - 8}px`;

  // Collapsing ring for the suck-in close animation.
  const ring = document.createElement("div");
  ring.className = "ring";
  root.appendChild(ring);
  ring.style.left = `${HUB.x}px`;
  ring.style.top = `${HUB.y}px`;

  // Snippet pills + connectors.
  const pills = templates.map((t, i) => {
    const line = svgEl("path", { class: "line", d: connectorPath(slotY(i, 0), SNIPPET.x) }) as SVGPathElement;
    const dot = svgEl("circle", { class: "dot", r: 3, cx: SNIPPET.x, cy: slotY(i, 0) }) as SVGCircleElement;
    svg.append(line, dot);

    const pill = document.createElement("div");
    pill.className = "pill snippet hit";
    pill.textContent = truncate(t.name);
    pill.dataset.index = String(i);
    pill.innerHTML = `<span class="chev">›</span>`;
    pill.insertBefore(document.createTextNode(truncate(t.name)), pill.firstChild);
    root.appendChild(pill);
    placePill(pill, i, 0);
    return { pill, line, dot };
  });

  // Brackets.
  const brackets: [SVGPathElement, SVGPathElement] = [
    svgEl("path", { class: "bracket", d: bracketPath("top") }) as SVGPathElement,
    svgEl("path", { class: "bracket", d: bracketPath("bottom") }) as SVGPathElement,
  ];
  svg.append(...brackets);

  // Action pills + connectors (initially detached from any slot).
  const actionPills = ACTIONS.map((a) => {
    const line = svgEl("path", { class: "line action", d: "" }) as SVGPathElement;
    const dot = svgEl("circle", { class: "dot action", r: 3 }) as SVGCircleElement;
    svg.append(line, dot);
    const pill = document.createElement("div");
    pill.className = "pill action hit";
    pill.textContent = a.label;
    pill.dataset.key = a.key;
    root.appendChild(pill);
    return { pill, line, dot };
  });

  // Settings entry pill (Left arrow from the hub; no brackets by design).
  const sLine = svgEl("path", {
    class: "line hidden",
    d: settingsConnectorPath(HUB.y),
  }) as SVGPathElement;
  const sDot = svgEl("circle", {
    class: "dot hidden",
    r: 3,
    cx: SETTINGS.rightEdge,
    cy: HUB.y,
  }) as SVGCircleElement;
  const settingsPillEl = document.createElement("div");
  settingsPillEl.className = "pill settings hit";
  settingsPillEl.innerHTML = `${icon("sliders", 16)}<span class="label">Настройки</span>`;
  settingsPillEl.style.left = `${SETTINGS.x}px`;
  settingsPillEl.style.top = `${HUB.y - SNIPPET.height / 2}px`;
  root.appendChild(settingsPillEl);
  svg.append(sLine, sDot);

  return {
    root,
    svg,
    hub,
    ring,
    pills,
    brackets,
    actionPills,
    settingsPill: { pill: settingsPillEl, line: sLine, dot: sDot },
  };
}

/** Places a snippet pill for template `index` at viewport offset `scroll`. */
export function placePill(pill: HTMLDivElement, index: number, scroll: number): void {
  const y = slotY(index, scroll);
  pill.style.left = `${SNIPPET.x}px`;
  pill.style.top = `${y - SNIPPET.height / 2}px`;
}

/** Positioning context for one render pass. */
export interface RenderContext {
  /** Which slot row each visible action line connects from. */
  actionFromY: number | null;
}

/**
 * Applies a model to the DOM: positions, selection classes, visibility and
 * connector paths. Pure DOM updates - motion comes from CSS transitions.
 */
export function update(dom: OverlayDom, m: OverlayModel): void {
  const snippetsVisible = m.phase !== "hub";
  dom.root.classList.toggle("phase-snippets", m.phase === "snippets");
  dom.root.classList.toggle("phase-actions", m.phase === "actions");
  dom.root.classList.toggle("phase-hub", m.phase === "hub");

  dom.pills.forEach(({ pill, line, dot }, i) => {
    const slot = i - m.scroll;
    placePill(pill, i, m.scroll);
    const visible = snippetsVisible && slot >= 0 && slot < SNIPPET.visible;
    pill.classList.toggle("visible", visible);
    pill.classList.toggle("selected", m.phase !== "hub" && i === m.selected);
    const y = slotY(i, m.scroll);
    const selected = m.phase !== "hub" && i === m.selected;
    line.setAttribute("d", connectorPath(y, SNIPPET.x));
    line.setAttribute("class", visible ? (selected ? "line selected" : "line") : "line hidden");
    dot.setAttribute("cy", String(y));
    dot.setAttribute("class", visible ? (selected ? "dot selected" : "dot") : "dot hidden");
  });

  dom.brackets.forEach((b) => b.setAttribute("class", snippetsVisible ? "bracket" : "bracket hidden"));

  // Action pills exist only in the actions phase, attached to the selected slot.
  const fromY = slotY(m.selected, m.scroll);
  dom.actionPills.forEach(({ pill, line, dot }, k) => {
    const visible = m.phase === "actions";
    const y = actionY(fromY, k);
    const selected = visible && k === m.actionSelected;
    pill.style.left = `${ACTION.x}px`;
    pill.style.top = `${y - ACTION.height / 2}px`;
    pill.classList.toggle("visible", visible);
    pill.classList.toggle("selected", selected);
    line.setAttribute("d", actionConnectorPath(fromY, y, ACTION.x));
    line.setAttribute("class", visible ? (selected ? "line action selected" : "line action") : "line action hidden");
    dot.setAttribute("cx", String(ACTION.x));
    dot.setAttribute("cy", String(y));
    dot.setAttribute("class", visible ? (selected ? "dot action selected" : "dot action") : "dot action hidden");
  });

  // Settings entry pill exists only in the settings phase (center slot).
  const settingsVisible = m.phase === "settings";
  dom.settingsPill.pill.classList.toggle("visible", settingsVisible);
  dom.settingsPill.pill.classList.toggle("selected", settingsVisible);
  dom.settingsPill.line.setAttribute(
    "class",
    settingsVisible ? "line selected" : "line hidden",
  );
  dom.settingsPill.dot.setAttribute("class", settingsVisible ? "dot selected" : "dot hidden");
}
