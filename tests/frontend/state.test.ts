/**
 * Unit tests for the overlay state machine (phases, navigation, scrolling).
 */

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  VISIBLE_SLOTS,
  clampScroll,
  expand,
  initialModel,
  moveDown,
  moveUp,
  retract,
  selectAction,
  type OverlayModel,
} from "../../src/frontend/src/overlay/state";

function model(count: number, partial: Partial<OverlayModel> = {}): OverlayModel {
  return { ...initialModel(count), ...partial };
}

describe("initialModel", () => {
  it("starts in the hub phase", () => {
    const m = initialModel(10);
    expect(m.phase).toBe("hub");
    expect(m.selected).toBe(0);
    expect(m.scroll).toBe(0);
    expect(m.actionSelected).toBe(0);
  });

  it("clamps negative counts", () => {
    expect(initialModel(-3).count).toBe(0);
  });
});

describe("expand/retract", () => {
  it("hub -> snippets -> actions -> snippets -> hub", () => {
    let m = initialModel(4);
    m = expand(m)!;
    expect(m.phase).toBe("snippets");
    m = expand(m)!;
    expect(m.phase).toBe("actions");
    expect(m.actionSelected).toBe(0);
    m = retract(m)!;
    expect(m.phase).toBe("snippets");
    m = retract(m)!;
    expect(m.phase).toBe("hub");
  });

  it("expand is null at actions and with zero templates", () => {
    expect(expand(model(1, { phase: "actions" }))).toBeNull();
    expect(expand(initialModel(0))).toBeNull();
  });

  it("retract is null at the hub", () => {
    expect(retract(initialModel(1))).toBeNull();
  });
});

describe("navigation", () => {
  it("moveUp does nothing at the hub or on the first item", () => {
    const hub = initialModel(5);
    expect(moveUp(hub)).toBe(hub);
    const first = model(5, { phase: "snippets", selected: 0 });
    expect(moveUp(first)).toBe(first);
  });

  it("moveDown expands from the hub", () => {
    const m = moveDown(initialModel(5));
    expect(m.phase).toBe("snippets");
  });

  it("moveDown stops at the last item", () => {
    const last = model(5, { phase: "snippets", selected: 4 });
    expect(moveDown(last)).toBe(last);
  });

  it("moveDown in actions moves the action selection", () => {
    const a = model(5, { phase: "actions", actionSelected: 0 });
    expect(moveDown(a).actionSelected).toBe(1);
    const maxed = model(5, { phase: "actions", actionSelected: 3 });
    expect(moveDown(maxed)).toBe(maxed);
  });

  it("moveUp in actions moves the action selection up", () => {
    const a = model(5, { phase: "actions", actionSelected: 2 });
    expect(moveUp(a).actionSelected).toBe(1);
    const top = model(5, { phase: "actions", actionSelected: 0 });
    expect(moveUp(top)).toBe(top);
  });

  it("moveUp in actions never detaches the list from the snippet", () => {
    const a = model(5, { phase: "actions", selected: 3, actionSelected: 1 });
    const next = moveUp(a);
    expect(next.selected).toBe(3);
    expect(next.actionSelected).toBe(0);
  });
});

describe("scroll clamping", () => {
  it("keeps the selection visible when moving down past the window", () => {
    let m = model(12, { phase: "snippets", selected: 3, scroll: 0 });
    m = moveDown(m);
    expect(m.selected).toBe(4);
    expect(m.scroll).toBe(0);
    m = moveDown(m); // selected 5 -> must scroll to 1
    expect(m.selected).toBe(5);
    expect(m.scroll).toBe(1);
  });

  it("keeps the selection visible when moving up past the window", () => {
    let m = model(12, { phase: "snippets", selected: 1, scroll: 1 });
    m = moveUp(m); // selected 0 -> scroll 0
    expect(m.selected).toBe(0);
    expect(m.scroll).toBe(0);
  });

  it("no-ops at the very top even with an inconsistent scroll", () => {
    // Legacy parity: moveUp at selected=0 returns the model untouched.
    const m = model(12, { phase: "snippets", selected: 0, scroll: 1 });
    expect(moveUp(m)).toBe(m);
  });

  it("caps scroll for small lists", () => {
    const m = clampScroll(model(3, { phase: "snippets", selected: 2, scroll: 5 }));
    expect(m.scroll).toBe(0);
  });

  it("visible window is 5 slots", () => {
    expect(VISIBLE_SLOTS).toBe(5);
  });
});

describe("selectAction", () => {
  it("clamps to 0..3", () => {
    const m = model(1, { phase: "actions", actionSelected: 1 });
    expect(selectAction(m, -5).actionSelected).toBe(0);
    expect(selectAction(m, 99).actionSelected).toBe(3);
    expect(selectAction(m, 2).actionSelected).toBe(2);
  });

  it("returns the same instance when unchanged", () => {
    const m = model(1, { phase: "actions", actionSelected: 1 });
    expect(selectAction(m, 1)).toBe(m);
  });
});
