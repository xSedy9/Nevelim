/**
 * Unit tests for the shared formatting helpers.
 */

import { describe, expect, it } from "vitest";

import { formatSize } from "../../src/frontend/src/shared/format";

describe("formatSize", () => {
  it("formats bytes without decimals", () => {
    expect(formatSize(0)).toBe("0 Б");
    expect(formatSize(512)).toBe("512 Б");
    expect(formatSize(1023)).toBe("1023 Б");
  });

  it("formats kilobytes with one decimal", () => {
    expect(formatSize(1024)).toBe("1.0 КБ");
    expect(formatSize(2048)).toBe("2.0 КБ");
    expect(formatSize(5632)).toBe("5.5 КБ");
  });

  it("formats megabytes and gigabytes", () => {
    expect(formatSize(1_572_864)).toBe("1.5 МБ");
    expect(formatSize(3_435_973_837)).toBe("3.2 ГБ");
  });

  it("handles junk input", () => {
    expect(formatSize(-5)).toBe("0 Б");
    expect(formatSize(Number.NaN)).toBe("0 Б");
  });
});
