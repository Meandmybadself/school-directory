// `shortClassroomName` — the year and the teacher's surname.
//
// The directory row names the classrooms a Person is on the roster of
// (invariant 18). This instance's rooms come from the district's roster export
// and run four segments, so the label needed eliding rather than clipping: CSS
// ellipsis cuts from the END, and every child in a grade would truncate to the
// same "Grade 2 · Juntos · Pam Sh…".
//
// The rule reads its segments by SHAPE rather than position, because the order
// is not stable even inside this repo: production rooms run
// grade-programme-teacher-room, while the demo seed's "Ms. Ruiz · Grade 4" puts
// the teacher first. So both shapes are pinned here, along with the cases where
// a rule like this usually goes wrong: a name it must not touch, a separator
// that isn't one, a programme it must not mistake for a room, and the guarantee
// that it never invents a character the school didn't type.

import { describe, expect, it } from "vitest";
import { GROUP_KINDS, groupLabel, shortClassroomName } from "@sd/shared";

describe("shortClassroomName", () => {
  it("keeps the grade and the teacher's surname from this instance's four-segment names", () => {
    expect(shortClassroomName("Grade 2 · Juntos · Pam Shrestha · Rm 322")).toBe("Gr 2 - Shrestha");
    expect(shortClassroomName("Grade 2 · XinXing · Lin Niu · Rm 320")).toBe("Gr 2 - Niu");
    expect(shortClassroomName("Grade 5 · Juntos · Beatriz Arteagamoreno · Rm 410")).toBe("Gr 5 - Arteagamoreno");
  });

  it("keeps two rooms in one grade distinguishable", () => {
    // The whole point of the feature. If these ever collide, the label is
    // worse than the full name it replaced.
    const a = shortClassroomName("Grade 2 · Juntos · Pam Shrestha · Rm 322");
    const b = shortClassroomName("Grade 2 · XinXing · Lin Niu · Rm 320");
    expect(a).not.toBe(b);
  });

  it("reads the seed's reversed two-segment shape too", () => {
    // "Ms. Ruiz · Grade 4" puts the teacher FIRST and carries no room. A
    // positional rule would take the wrong half; reading by shape gets both.
    expect(shortClassroomName("Ms. Ruiz · Grade 4")).toBe("Gr 4 - Ruiz");
    expect(shortClassroomName("Ms. Ruiz  ·   Grade 4")).toBe("Gr 4 - Ruiz");
  });

  it("abbreviates kindergarten to K", () => {
    expect(shortClassroomName("Kindergarten · Juntos · Ana Ortiz · Rm 5")).toBe("K - Ortiz");
    // Word-bounded rather than whole-segment, so a session suffix survives.
    expect(shortClassroomName("Kindergarten AM · Juntos · Ana Ortiz · Rm 5")).toBe("K AM - Ortiz");
    // A bare "K" matches neither abbreviation and passes through: it already
    // IS the short form, and a rule that rewrote it would be looking for work.
    expect(shortClassroomName("K · Juntos · Ana Ortiz · Rm 5")).toBe("K - Ortiz");
  });

  it("returns a name it cannot read byte for byte", () => {
    // Silence beats a confident mislabel: a row showing the WRONG room is worse
    // than one showing a long right one, so anything unreadable is left to CSS.
    expect(shortClassroomName("Room 12")).toBe("Room 12");          // no separator
    expect(shortClassroomName("Room 3B")).toBe("Room 3B");          // no grade
    expect(shortClassroomName("Juntos · Rm 322")).toBe("Juntos · Rm 322"); // no grade
    // A grade and a room with no teacher between them: there is no surname to
    // name, so it must not fall back to labelling the grade with itself.
    expect(shortClassroomName("Grade 2 · Rm 322")).toBe("Grade 2 · Rm 322");
  });

  it("does not treat a hyphen or a dash as a separator", () => {
    // "Ruiz–Lee" is one surname. A rule that split on dashes would cut a family
    // in half, which is why only the middle dot counts.
    expect(shortClassroomName("Grade 3 - Ruiz–Lee - Rm 101")).toBe("Grade 3 - Ruiz–Lee - Rm 101");
    expect(shortClassroomName("Ruiz–Lee, Grade 3, Rm 101")).toBe("Ruiz–Lee, Grade 3, Rm 101");
  });

  it("invents nothing the school did not write", () => {
    // Invariant 6: it elides and abbreviates, never restates. It appends no
    // ellipsis of its own — the shortened form has to read as a name, not as a
    // truncation — and every word it emits is a PREFIX of a word the school
    // typed. "Gr" and "K" are the abbreviations, so prefix rather than equality
    // is the honest claim; the hyphen is the only punctuation it adds.
    const source = "Grade 2 · Juntos · Pam Shrestha · Rm 322";
    const out = shortClassroomName(source);
    expect(out).toBe("Gr 2 - Shrestha");
    expect(out).not.toContain("…");
    expect(out).not.toContain("...");
    const sourceWords = source.split(/[\s·]+/).filter(Boolean);
    for (const word of out.split(/\s+/).filter((w) => w !== "-")) {
      expect(sourceWords.some((w) => w.startsWith(word))).toBe(true);
    }
    // And the surname itself is never abbreviated — only the year is.
    expect(out).toContain("Shrestha");
  });

  it("survives ragged spacing and a trailing separator", () => {
    expect(shortClassroomName("Grade 2·Juntos·Pam Shrestha·Rm 322")).toBe("Gr 2 - Shrestha");
    expect(shortClassroomName("  Grade 2 ·  Juntos · Pam Shrestha ·  Rm 322  ")).toBe("Gr 2 - Shrestha");
    // A trailing dot leaves an empty segment, which must not become the label.
    expect(shortClassroomName("Grade 2 · Juntos · Pam Shrestha · Rm 322 ·")).toBe("Gr 2 - Shrestha");
  });

  it("does not mistake a programme for the room it sits beside", () => {
    // The room test requires a DIGIT precisely so a programme called "Room to
    // Grow" cannot anchor the teacher one segment too early — which would label
    // this row "Grade 3 - Community", naming a programme as a person.
    expect(shortClassroomName("Grade 3 · Room to Grow · Ana Ortiz · Rm 7")).toBe("Gr 3 - Ortiz");
  });

  it("keeps a hyphenated surname whole", () => {
    // "Ruiz–Lee" is one word joined by an en dash, so it survives intact — the
    // reason a dash is not a separator in the first place.
    expect(shortClassroomName("Grade 1 · Community · Dana Ruiz–Lee · Rm 101")).toBe("Gr 1 - Ruiz–Lee");
    // A surname that is genuinely two WORDS reduces to the last of them. That
    // is the known cost of a rule with no list of names to consult, pinned so
    // it is a decision rather than a surprise.
    expect(shortClassroomName("Grade 3 · Juntos · Mary Van Dyke · Rm 7")).toBe("Gr 3 - Dyke");
  });

  it("refuses a room with no teacher rather than naming the programme", () => {
    // A person is written "First Last", so a one-word segment beside the room
    // is a PROGRAMME. Without that test this reads "Grade 2 - Juntos", which
    // presents a programme as a person — the exact mislabel the rule's
    // refuse-by-default posture exists to avoid.
    expect(shortClassroomName("Grade 2 · Juntos · Rm 322")).toBe("Grade 2 · Juntos · Rm 322");
    expect(shortClassroomName("Grade 2 · XinXing · Rm 320")).toBe("Grade 2 · XinXing · Rm 320");
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
    expect(groupLabel(name, "classroom")).toBe("Gr 1 - Oyelaran");
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
    expect(a).toBe("Gr 1 - Oyelaran");
    expect(b).toBe("Gr 1 - Whitfield");
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
