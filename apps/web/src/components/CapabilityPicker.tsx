// The "type" chips — Parent, Student, Teacher, Staff — toggled on a Person by
// whoever controls them. Used by the add form and the edit form so the two
// offer the same set in the same order; the set itself is
// ASSIGNABLE_CAPABILITIES, which is where `household_admin` is kept out.
import { ASSIGNABLE_CAPABILITIES, type Capability } from "@sd/shared";
import { Icon } from "./Icon.js";
import { capLabel, useI18n } from "../i18n/index.js";

export function CapabilityPicker({ value, onChange }: { value: Capability[]; onChange: (next: Capability[]) => void }) {
  const { t } = useI18n();
  const toggle = (cap: Capability) =>
    onChange(value.includes(cap) ? value.filter((x) => x !== cap) : [...value, cap]);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {ASSIGNABLE_CAPABILITIES.map((cap) => {
        const on = value.includes(cap);
        return (
          <button
            key={cap}
            type="button"
            onClick={() => toggle(cap)}
            aria-pressed={on}
            className="sd-tag"
            style={{
              cursor: "pointer", font: "inherit",
              border: "1px solid " + (on ? "var(--blue)" : "var(--line)"),
              background: on ? "var(--blue)" : "var(--paper)",
              color: on ? "var(--on-brand)" : "var(--ink-2)",
            }}
          >
            {on && <Icon name="check" size={13} stroke={2.4} />}
            {capLabel(t, cap)}
          </button>
        );
      })}
    </div>
  );
}
