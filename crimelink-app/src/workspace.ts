/**
 * Investigator workspace state.
 *
 * A lead list is only useful if it remembers what you have already dealt with.
 * Triage status is kept in the browser rather than the Data Store on purpose:
 * this is a prototype, and quietly writing case-handling decisions into a shared
 * police record is not something a demo should do. The shape is the same either
 * way, so it moves server-side unchanged when there is an authenticated officer
 * behind it.
 */
export type Status = "new" | "assigned" | "dismissed";

export const STATUSES: { id: Status; label: string; help: string }[] = [
  { id: "new", label: "New", help: "not yet looked at" },
  { id: "assigned", label: "Assigned", help: "handed to an investigating officer" },
  { id: "dismissed", label: "Dismissed", help: "reviewed and judged not a real link" },
];

const KEY = "drishti.triage";

export function loadStatuses(): Record<string, Status> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveStatuses(s: Record<string, Status>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode — status still holds for this session */
  }
}
