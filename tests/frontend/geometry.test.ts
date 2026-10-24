/**
 * Unit tests for overlay geometry: slot layout, connectors, hit-testing,
 * and the sparkle path builder.
 */

import { describe, expect, it } from "vitest";

import {
  ACTION,
  HUB,
  SETTINGS,
  SETTINGS_ACTION,
  SNIPPET,
  actionConnectorPath,
  actionY,
  bracketPath,
  connectorPath,
  isActionClick,
  isHubClick,
  isSettingsActionClick,
  isSettingsClick,
  isSnippetClick,
  settingsActionConnectorPath,
  settingsActionY,
  settingsConnectorPath,
  slotY,
  sparklePath,
} from "../../src/frontend/src/overlay/geometry";

describe("layout", () => {
  it("slots sit 46px apart around the hub row", () => {
    expect(slotY(2, 0)).toBe(HUB.y);
    expect(slotY(0, 0)).toBe(HUB.y - 2 * SNIPPET.step);
    expect(slotY(3, 1)).toBe(HUB.y); // scrolled by one: index 3 takes the center slot
  });

  it("action rows fan out around the source slot", () => {
    expect(actionY(200, 0)).toBe(200 - 1.5 * ACTION.step);
    expect(actionY(200, 3)).toBe(200 + 1.5 * ACTION.step);
  });
});

describe("paths", () => {
  it("connector starts at the hub edge and ends at the pill", () => {
    const d = connectorPath(200, SNIPPET.x);
    expect(d.startsWith(`M ${HUB.x + HUB.r} ${HUB.y}`)).toBe(true);
    expect(d.endsWith(`${SNIPPET.x} 200`)).toBe(true);
  });

  it("action connector starts at the snippet right edge", () => {
    const d = actionConnectorPath(200, 150, ACTION.x);
    expect(d.startsWith(`M ${SNIPPET.x + SNIPPET.width} 200`)).toBe(true);
    expect(d.endsWith(`${ACTION.x} 150`)).toBe(true);
  });

  it("brackets wrap the visible list", () => {
    const top = bracketPath("top");
    const bottom = bracketPath("bottom");
    expect(top).toContain(`L ${SNIPPET.x + 35}`);
    expect(bottom).toContain(`L ${SNIPPET.x + 35}`);
    expect(top.split(" ").length).toBeGreaterThan(6);
  });

  it("brackets adapt bottom position to visible snippet count (1 to 5)", () => {
    const b1 = bracketPath("bottom", 1);
    const expectedY1 = slotY(0, 0) + SNIPPET.height / 2 + 14;
    expect(b1).toContain(`L ${SNIPPET.x + 35} ${expectedY1}`);

    const b2 = bracketPath("bottom", 2);
    const expectedY2 = slotY(1, 0) + SNIPPET.height / 2 + 14;
    expect(b2).toContain(`L ${SNIPPET.x + 35} ${expectedY2}`);

    const b3 = bracketPath("bottom", 3);
    const expectedY3 = slotY(2, 0) + SNIPPET.height / 2 + 14;
    expect(b3).toContain(`L ${SNIPPET.x + 35} ${expectedY3}`);

    const b5 = bracketPath("bottom", 5);
    const expectedY5 = slotY(4, 0) + SNIPPET.height / 2 + 14;
    expect(b5).toContain(`L ${SNIPPET.x + 35} ${expectedY5}`);

    expect(bracketPath("bottom", 0)).toBe(b1);
    expect(bracketPath("bottom", 10)).toBe(b5);
  });

  it("sparkle path is a closed 4-tip star", () => {
    const d = sparklePath(32, 32, 18.5);
    expect(d.startsWith("M 32 13.5")).toBe(true); // 32 - 18.5
    expect(d.endsWith("Z")).toBe(true);
    expect(d.match(/L /g)!.length).toBeGreaterThan(60);
  });
});

describe("settings (left side)", () => {
  it("mirrors the snippet column on the left of the hub", () => {
    expect(SETTINGS.rightEdge).toBe(HUB.x - 110);
    expect(SETTINGS.x + SETTINGS.width).toBe(SETTINGS.rightEdge);
  });

  it("settings connector starts at the hub left edge", () => {
    const d = settingsConnectorPath(HUB.y);
    expect(d.startsWith(`M ${HUB.x - HUB.r} ${HUB.y}`)).toBe(true);
    expect(d.endsWith(`${SETTINGS.rightEdge} ${HUB.y}`)).toBe(true);
  });

  it("settings hit covers the pill rect", () => {
    expect(isSettingsClick(SETTINGS.x + 10, HUB.y)).toBe(true);
    expect(isSettingsClick(SETTINGS.x - 5, HUB.y)).toBe(false);
    expect(isSettingsClick(SETTINGS.x + 10, HUB.y + SETTINGS.height)).toBe(false);
  });

  it("settings actions mirror the snippet action column", () => {
    expect(SETTINGS_ACTION.x + SETTINGS_ACTION.width).toBe(SETTINGS_ACTION.rightEdge);
    // Same gap from the parent pill as the snippet actions have.
    expect(SETTINGS.x - SETTINGS_ACTION.rightEdge).toBe(ACTION.x - (SNIPPET.x + SNIPPET.width));
    expect(SETTINGS_ACTION.width).toBe(ACTION.width);
    expect(SETTINGS_ACTION.height).toBe(ACTION.height);
    expect(SETTINGS_ACTION.step).toBe(ACTION.step);
    expect(SETTINGS_ACTION.x).toBeLessThan(SETTINGS.x);
  });

  it("settings action connector starts at the settings pill left edge", () => {
    const d = settingsActionConnectorPath(HUB.y, 150, SETTINGS_ACTION.rightEdge);
    expect(d.startsWith(`M ${SETTINGS.x} ${HUB.y}`)).toBe(true);
    expect(d.endsWith(`${SETTINGS_ACTION.rightEdge} 150`)).toBe(true);
  });

  it("settings action rows center on the settings row", () => {
    // Middle action (Export) sits exactly on the settings row.
    expect(settingsActionY(1)).toBe(HUB.y);
    expect(settingsActionY(0)).toBe(HUB.y - SETTINGS_ACTION.step);
    expect(settingsActionY(2)).toBe(HUB.y + SETTINGS_ACTION.step);
  });

  it("settings action hit covers the pill rect", () => {
    const ay = settingsActionY(1);
    expect(isSettingsActionClick(SETTINGS_ACTION.x + 5, ay, 1)).toBe(true);
    expect(isSettingsActionClick(SETTINGS_ACTION.x + SETTINGS_ACTION.width + 5, ay, 1)).toBe(false);
    expect(isSettingsActionClick(SETTINGS_ACTION.x + 5, ay + SETTINGS_ACTION.height, 1)).toBe(false);
  });
});

describe("hit-testing", () => {
  it("hub hit radius extends 14px beyond the circle", () => {
    expect(isHubClick(HUB.x, HUB.y)).toBe(true);
    expect(isHubClick(HUB.x + HUB.r + 13, HUB.y)).toBe(true);
    expect(isHubClick(HUB.x + HUB.r + 15, HUB.y)).toBe(false);
  });

  it("snippet hit covers the pill rect", () => {
    const y = slotY(2, 0);
    expect(isSnippetClick(SNIPPET.x + 10, y, 2, 0)).toBe(true);
    expect(isSnippetClick(SNIPPET.x + SNIPPET.width + 1, y, 2, 0)).toBe(false);
    expect(isSnippetClick(SNIPPET.x + 10, y + SNIPPET.height, 2, 0)).toBe(false);
  });

  it("action hit covers the pill rect", () => {
    const fromY = slotY(2, 0);
    const ay = actionY(fromY, 1);
    expect(isActionClick(ACTION.x + 5, ay, fromY, 1)).toBe(true);
    expect(isActionClick(ACTION.x + ACTION.width + 5, ay, fromY, 1)).toBe(false);
  });
});
