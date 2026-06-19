// Shared contact-type options for the type <select> in both the person and the
// household/group contact editors, so they stay consistent.
import type { ContactType, Strings } from "@sd/shared";

/** Order shown in the type dropdown. */
export const CONTACT_TYPE_ORDER: ContactType[] = ["address", "email", "url", "phone"];

/** Generic type name for the dropdown (Address / Email / Website / Phone).
 *  Distinct from the contextual display label (e.g. "Home Address", "Mobile"). */
export function contactTypeName(tp: ContactType, t: (k: keyof Strings) => string): string {
  switch (tp) {
    case "address":
      return t("typeAddress");
    case "email":
      return t("email");
    case "url":
      return t("website");
    case "phone":
      return t("typePhone");
  }
}
