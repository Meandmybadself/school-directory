// `shortClassroomName` — the grade and the room, nothing between.
//
// The directory row names the classrooms a Person is on the roster of
// (invariant 18). This instance's rooms come from the district's roster export
// and run four segments, so the label needed eliding rather than clipping: CSS
// ellipsis cuts from the END, and the end is the room number, which is the one
// segment that tells two children in a grade apart.
//
// The cases worth pinning are the ones where a rule like this usually goes
// wrong: a name it must not touch, a separator that isn't one, and the
// guarantee that it never invents a character the school didn't type.

import { describe, expect, it } from "vitest";
import { GROUP_KINDS, groupLabel, shortClassroomName } from "@sd/shared";

describe("shortClassroomName", () => {
  it("keeps the grade and the room from this instance's four-segment names", () => {
    expect(shortClassroomName("Grade 2 · Juntos · Pam Shrestha · Rm 322")).toBe("Grade 2 · Rm 322");
    expect(shortClassroomName("Grade 2 · XinXing · Lin Niu · Rm 320")).toBe("Grade 2 · Rm 320");
    expect(shortClassroomName("Grade 5 · Juntos · Beatriz Arteagamoreno · Rm 410")).toBe("Grade 5 · Rm 410");
  });

  it("keeps two rooms in one grade distinguishable", () => {
    // The whole point of the feature. If these ever collide, the label is
    // worse than the full name it replaced.
    const a = shortClassroomName("Grade 2 · Juntos · Pam Shrestha · Rm 322");
    const b = shortClassroomName("Grade 2 · XinXing · Lin Niu · Rm 320");
    expect(a).not.toBe(b);
  });

  it("returns a one- or two-segment name byte for byte", () => {
    // Two segments already ARE first-and-last, so there is nothing to elide and
    // no licence to normalise spacing. A name this cannot improve must survive
    // it untouched — including the demo seed's own classroom.
    expect(shortClassroomName("Ms. Ruiz · Grade 4")).toBe("Ms. Ruiz · Grade 4");
    expect(shortClassroomName("Room 12")).toBe("Room 12");
    expect(shortClassroomName("Ms. Ruiz  ·   Grade 4")).toBe("Ms. Ruiz  ·   Grade 4");
  });

  it("does not treat a hyphen or a dash as a separator", () => {
    // "Ruiz–Lee" is one surname. A rule that split on dashes would cut a family
    // in half, which is why only the middle dot counts.
    expect(shortClassroomName("Grade 3 - Ruiz–Lee - Rm 101")).toBe("Grade 3 - Ruiz–Lee - Rm 101");
    expect(shortClassroomName("Ruiz–Lee, Grade 3, Rm 101")).toBe("Ruiz–Lee, Grade 3, Rm 101");
  });

  it("emits only characters the school typed", () => {
    // Eliding, not translating (invariant 6): every segment it keeps is the
    // school's own text, and it never appends an ellipsis of its own — the
    // shortened form has to read as a name, not as a truncation.
    const out = shortClassroomName("Grade 2 · Juntos · Pam Shrestha · Rm 322");
    expect(out).not.toContain("…");
    expect(out).not.toContain("...");
    for (const segment of out.split("·").map((p) => p.trim())) {
      expect("Grade 2 · Juntos · Pam Shrestha · Rm 322").toContain(segment);
    }
  });

  it("survives ragged spacing and a trailing separator", () => {
    expect(shortClassroomName("Grade 2·Juntos·Pam Shrestha·Rm 322")).toBe("Grade 2 · Rm 322");
    expect(shortClassroomName("  Grade 2 ·  Juntos · Pam Shrestha ·  Rm 322  ")).toBe("Grade 2 · Rm 322");
    // A trailing dot leaves an empty segment, which must not become the label.
    expect(shortClassroomName("Grade 2 · Juntos · Rm 322 ·")).toBe("Grade 2 · Rm 322");
  });

  it("never returns something longer than it was given", () => {
    for (const name of [
      "Grade 2 · Juntos · Pam Shrestha · Rm 322",
      "Ms. Ruiz · Grade 4",
      "Room 12",
      "Grade 2·Juntos·Rm 322",
    ]) {
      expect(shortClassroomName(name).length).toBeLessThanOrEqual(name.length);
    }
  });
});

// `groupLabel` — the same rule, dispatched on a group's kind.
//
// The groups listing renders households, classrooms and generic groups in ONE
// table whose name column is ~170px on a phone, so every caller there needed
// the kind test as well as the rule. These pin the dispatch: what it must
// elide, what it must leave alone, and that it stays total over `GroupKind`.

describe("groupLabel", () => {
  it("elides a classroom and nothing else", () => {
    const name = "Grade 1 · Community · Sam Oyelaran · Rm 104";
    expect(groupLabel(name, "classroom")).toBe("Grade 1 · Rm 104");
    // A generic group's segments do NOT mean grade-and-room: eliding
    // "Grade 4 · Chess Club · Eisenhower" would drop the one segment that
    // names the thing. Same for a household, whose name is a family's.
    expect(groupLabel("Grade 4 · Chess Club · Eisenhower", "generic")).toBe("Grade 4 · Chess Club · Eisenhower");
    expect(groupLabel("Ruiz–Lee · Okonkwo · Household", "household")).toBe("Ruiz–Lee · Okonkwo · Household");
  });

  it("keeps two rooms in one grade apart where CSS ellipsis would not", () => {
    // The listing bug this exists for: both of these clip to the same
    // "Grade 1 · Commu…" at the width the table gives them.
    const a = groupLabel("Grade 1 · Community · Sam Oyelaran · Rm 104", "classroom");
    const b = groupLabel("Grade 1 · Community · Dana Whitfield · Rm 106", "classroom");
    expect(a).not.toBe(b);
    expect(a).toBe("Grade 1 · Rm 104");
    expect(b).toBe("Grade 1 · Rm 106");
  });

  it("agrees with shortClassroomName on every classroom name", () => {
    // It must stay a dispatch, never a second copy of the rule.
    for (const name of [
      "Grade 2 · Juntos · Pam Shrestha · Rm 322",
      "Ms. Ruiz · Grade 4",
      "Room 12",
      "Grade 2·Juntos·Rm 322",
    ]) {
      expect(groupLabel(name, "classroom")).toBe(shortClassroomName(name));
    }
  });

  it("returns a usable label for every kind the schema has", () => {
    // A kind added to GROUP_KINDS and not considered here would fall through to
    // whatever the last branch happens to be; this fails the day that is empty.
    for (const kind of GROUP_KINDS) {
      expect(groupLabel("Room 12", kind)).toBe("Room 12");
    }
  });
});
