// Onboarding state that lives on the device rather than the server.
//
// The "you skipped adding your family" nudge on Home is deliberately scoped to
// people who actually went through the welcome wizard and declined — NOT to
// every member who happens to control one Person. Those two look identical in
// the database (one person, no household), so the only honest way to tell them
// apart is a marker written by the wizard itself. A member who joined before
// this shipped never gets the marker and is never nagged.
//
// localStorage, matching GROUPS_HELP_KEY in screens/Group.tsx. It is per-device,
// so skipping on a phone and opening on a laptop shows no nudge — acceptable for
// something that is a reminder rather than a gate, and the same tradeoff that
// precedent already accepts. Nothing identifying is stored: the value is "1".

import type { I18nT } from "../i18n/index.js";

const SKIPPED_KEY = "sd.onboardingSkipped";

export function markOnboardingSkipped(): void {
  try {
    localStorage.setItem(SKIPPED_KEY, "1");
  } catch {
    // Private-mode Safari and friends throw on write. A nudge that fails to
    // arm itself is not worth breaking the flow the member is finishing.
  }
}

export function clearOnboardingSkipped(): void {
  try {
    localStorage.removeItem(SKIPPED_KEY);
  } catch {
    /* see above */
  }
}

export function wasOnboardingSkipped(): boolean {
  try {
    return localStorage.getItem(SKIPPED_KEY) === "1";
  } catch {
    return false;
  }
}

/** The household name proposed when the wizard founds one.
 *
 *  Composed here, on the client, because the API has no locale of its own — a
 *  household name is ordinary member-editable data (the same field someone types
 *  by hand in the group sheet), not server-rendered chrome. Falls back to the
 *  first name when someone gave no surname, which is common enough that "The
 *  family" alone would read as a bug. */
export function householdNameFor(
  firstName: string,
  lastName: string | null,
  t: I18nT,
): string {
  const last = lastName?.trim();
  if (last) return t("householdAutoName", { lastName: last });
  return t("householdAutoNameFallback", { firstName: firstName.trim() });
}
