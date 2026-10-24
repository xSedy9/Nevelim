/**
 * Unit tests for the shared formatting helpers.
 */

import { describe, expect, it } from "vitest";

import { formatSize } from "../../src/frontend/src/shared/format";

describe("formatSize", () => {
  it("formats bytes without decimals", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1023)).toBe("1023 B");
  });

  it("formats kilobytes with one decimal", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(5632)).toBe("5.5 KB");
  });

  it("formats megabytes and gigabytes", () => {
    expect(formatSize(1_572_864)).toBe("1.5 MB");
    expect(formatSize(3_435_973_837)).toBe("3.2 GB");
  });

  it("handles junk input", () => {
    expect(formatSize(-5)).toBe("0 B");
    expect(formatSize(Number.NaN)).toBe("0 B");
  });
});
