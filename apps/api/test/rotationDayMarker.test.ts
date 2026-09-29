// The Eisenhower feed marks nearly every school day with an all-day
// `Day "1"` / `Day "2"` / `Day "3"`. refreshSource drops them at ingest; this
// pins what counts as one, written against the titles production actually holds.

import { describe, expect, it } from "vitest";
import { isRotationDayMarker } from "../src/lib/calendar.js";

describe("isRotationDayMarker", () => {
  it("matches the feed's rotation-day titles", () => {
    for (const t of ['Day "1"', 'Day "2"', 'Day "3"', "Day 4", "day 12", ' Day "1" ', "Day “2”"]) {
      expect(isRotationDayMarker(t), t).toBe(true);
    }
  });

  it("leaves real events that mention a day alone", () => {
    for (const t of [
      "Picture Re-Take Day",
      "No School E-12, MLK Day",
      "No School E-5 (Grading Day and Professional Development)",
      "Day 1 of Book Fair",
      "Field Day",
      "100th Day of School",
      "Day",
    ]) {
      expect(isRotationDayMarker(t), t).toBe(false);
    }
  });
});
