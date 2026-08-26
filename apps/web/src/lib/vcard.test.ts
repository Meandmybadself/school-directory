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

  it("recovers a visible surname from displayName when lastName isn't provided", () => {
    // The profile view fetches a member's-eye DTO with no raw lastName, but a
    // "full" last-name display still shows the surname in displayName — it must
    // reach N, not be dropped.
    const out = buildVCard({ fullName: "Dana Ruiz", firstName: "Dana", lastName: null, contacts: [] });
    expect(out).toContain("N:Ruiz;Dana;;;");
    expect(out).toContain("FN:Dana Ruiz");
  });

  it("carries an initials-only display name through as shown", () => {
    // A member who only sees "Dana R." saves exactly that — the trailing part is
    // an initial, and that is what's available.
    const out = buildVCard({ fullName: "Dana R.", firstName: "Dana", lastName: null, contacts: [] });
    expect(out).toContain("N:R.;Dana;;;");
    expect(out).toContain("FN:Dana R.");
  });

  it("leaves the family name empty when only a given name is available", () => {
    const out = buildVCard({ fullName: "Dana", firstName: "Dana", lastName: null, contacts: [] });
    expect(out).toContain("N:;Dana;;;");
  });

  it("prefers an explicit lastName over deriving from displayName", () => {
    const out = buildVCard({ fullName: "Dana R.", firstName: "Dana", lastName: "Ruiz", contacts: [] });
    expect(out).toContain("N:Ruiz;Dana;;;");
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

  it("embeds a photo as base64 with the mapped TYPE", () => {
    const out = buildVCard({
      fullName: "Dana",
      firstName: "Dana",
      contacts: [],
      photo: { base64: "QUJD", mime: "image/jpeg" },
    });
    expect(out).toContain("PHOTO;ENCODING=b;TYPE=JPEG:QUJD");
  });

  it("skips a photo of an unrecognized type rather than mislabeling it", () => {
    const out = buildVCard({
      fullName: "Dana",
      firstName: "Dana",
      contacts: [],
      photo: { base64: "QUJD", mime: "image/svg+xml" },
    });
    expect(out).not.toContain("PHOTO");
  });

  it("emits no PHOTO when there's no photo", () => {
    const out = buildVCard({ fullName: "Dana", firstName: "Dana", contacts: [], photo: null });
    expect(out).not.toContain("PHOTO");
  });

  it("folds a long photo line to <=75-octet lines that unfold to the payload", () => {
    const b64 = "A".repeat(300);
    const out = buildVCard({
      fullName: "Dana",
      firstName: "Dana",
      contacts: [],
      photo: { base64: b64, mime: "image/png" },
    });
    // No raw line exceeds 75 octets (RFC 2426 §2.6).
    expect(out.split("\r\n").every((l) => l.length <= 75)).toBe(true);
    // Unfolding (drop CRLF + leading space) restores the exact PHOTO payload.
    const unfolded = out.replace(/\r\n /g, "");
    expect(unfolded).toContain(`PHOTO;ENCODING=b;TYPE=PNG:${b64}`);
  });
});
