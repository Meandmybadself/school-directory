import { describe, it, expect } from "vitest";
import { haversineMiles, approxDistance, boundingBox } from "../src/lib/geo.js";
import { renderLastName, displayName } from "../src/lib/privacy.js";
import { ulid } from "../src/lib/ids.js";

describe("geo", () => {
  it("computes great-circle distance in miles", () => {
    // ~0.3 mi between two nearby SF points
    const d = haversineMiles(37.7849, -122.4094, 37.7853, -122.414);
    expect(d).toBeGreaterThan(0.2);
    expect(d).toBeLessThan(0.5);
  });

  it("rounds distance to one decimal and never exposes raw coords", () => {
    expect(approxDistance(0.43)).toBe("~0.4 mi");
    expect(approxDistance(1.05)).toMatch(/^~\d+\.\d mi$/);
  });

  it("bounding box brackets the point", () => {
    const b = boundingBox(37.78, -122.41, 2);
    expect(b.minLat).toBeLessThan(37.78);
    expect(b.maxLat).toBeGreaterThan(37.78);
  });
});

describe("last-name rule", () => {
  it("controllers always see the full name (even when set to initial)", () => {
    expect(renderLastName("Ruiz", "initial", true)).toBe("Ruiz");
    expect(displayName("Dana", "Ruiz", "initial", true)).toBe("Dana Ruiz");
  });
  it("non-controllers get full or initial per policy (never fully hidden)", () => {
    expect(renderLastName("Ruiz", "full", false)).toBe("Ruiz");
    expect(renderLastName("Ruiz", "initial", false)).toBe("R.");
    expect(displayName("Dana", "Ruiz", "full", false)).toBe("Dana Ruiz");
    expect(displayName("Dana", "Ruiz", "initial", false)).toBe("Dana R.");
  });
});

describe("ulid", () => {
  it("is 26 chars and monotonic within the same millisecond", () => {
    const a = ulid(1000);
    const b = ulid(1000);
    expect(a).toHaveLength(26);
    expect(b > a).toBe(true);
  });
  it("sorts by time", () => {
    const early = ulid(1000);
    const late = ulid(2000);
    expect(late > early).toBe(true);
  });
});
