// The zone every timed date and time in this app is read and written in.
//
// It is the SCHOOL'S zone, not the reader's: an event at 5:30 PM happens at
// 5:30 PM where the school is, and a parent reading the agenda from another
// zone, or an admin entering an event while travelling, must see and type that
// same 5:30. See packages/shared/src/timezone.ts for the whole rule.
//
// Set at build time with `VITE_SCHOOL_TIMEZONE`; it must name the same zone as
// the API's `SCHOOL_TIMEZONE`. Unset or invalid falls back to the shared
// default (America/Chicago).

import { resolveTimeZone } from "@sd/shared";

export const SCHOOL_TIME_ZONE = resolveTimeZone(import.meta.env.VITE_SCHOOL_TIMEZONE);
