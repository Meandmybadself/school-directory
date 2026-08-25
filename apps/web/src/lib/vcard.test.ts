import { describe, it, expect } from "vitest";
import { buildVCard } from "./vcard.js";

describe("buildVCard", () => {
  it("wraps the card and emits a structured name", () => {
    const out = buildVCard({ fullName: "Dana Ruiz", firstName: "Dana", lastName: "Ruiz", contacts: [] });
    const lines = out.split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCARD");
    expect(lines[1]).toBe("VERSION:3.0");
    expect(lines).toContain("N:Ruiz;Dana;;;");
    expect(lines).toContain("FN:Dana Ruiz");
    expect(lines).toContain("END:VCARD");
  });

  it("withholds the family name when the viewer isn't a controller", () => {
    // A member sees "Dana R." and no lastName; N carries the given name only.
    const out = buildVCard({ fullName: "Dana R.", firstName: "Dana", lastName: null, contacts: [] });
    expect(out).toContain("N:;Dana;;;");
    expect(out).toContain("FN:Dana R.");
  });

  it("maps each contact type to the right property", () => {
    const out = buildVCard({
      fullName: "Dana",
      firstName: "Dana",
      contacts: [
        { type: "phone", value: "555-1234", label: "Mobile" },
        { type: "email", value: "dana@x.test", label: null },
        { type: "url", value: "https://x.test", label: null },
      ],
    });
    expect(out).toContain("TEL;TYPE=CELL,VOICE:555-1234");
    expect(out).toContain("EMAIL;TYPE=INTERNET:dana@x.test");
    expect(out).toContain("URL:https://x.test");
  });

  it("derives TEL/ADR types from the label", () => {
    const out = buildVCard({
      fullName: "Dana",
      firstName: "Dana",
      contacts: [
        { type: "phone", value: "555", label: "Work" },
        { type: "address", value: "1 Main St", label: "Work" },
      ],
    });
    expect(out).toContain("TEL;TYPE=WORK,VOICE:555");
    expect(out).toContain("ADR;TYPE=WORK:;;1 Main St;;;;");
  });

  it("writes an address as both ADR and a display LABEL", () => {
    const out = buildVCard({
      fullName: "Dana",
      firstName: "Dana",
      contacts: [{ type: "address", value: "12 Oak Ave, Springfield", label: null }],
    });
    // The comma inside the address is escaped so it stays one field.
    expect(out).toContain("ADR;TYPE=HOME:;;12 Oak Ave\\, Springfield;;;;");
    expect(out).toContain("LABEL;TYPE=HOME:12 Oak Ave\\, Springfield");
  });

  it("escapes semicolons, commas, backslashes and newlines", () => {
    const out = buildVCard({
      fullName: "A;B,C\\D",
      firstName: "A",
      contacts: [{ type: "email", value: "a@x.test", label: null }],
    });
    expect(out).toContain("FN:A\\;B\\,C\\\\D");
  });

  it("skips contacts with empty or whitespace values", () => {
    const out = buildVCard({
      fullName: "Dana",
      firstName: "Dana",
      contacts: [
        { type: "phone", value: "   ", label: null },
        { type: "email", value: "dana@x.test", label: null },
      ],
    });
    expect(out).not.toContain("TEL");
    expect(out).toContain("EMAIL;TYPE=INTERNET:dana@x.test");
  });
});
