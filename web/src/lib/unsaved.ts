// Pages with edits that have not been saved say so here, so leaving can ask first. It is module-level state because the
// places that navigate (the nav bar, the Back button) are far from the forms that know. Several forms can be on one page, so
// each reports under its own key: leaving is only silent when none of them has unsaved edits.

const dirty = new Set<string>();
const MESSAGE = "You have changes that are not saved yet. Leave without saving?";

export function setUnsaved(v: boolean, key = "page") {
  if (v) dirty.add(key);
  else dirty.delete(key);
  window.onbeforeunload = dirty.size > 0 ? (e) => { e.preventDefault(); return MESSAGE; } : null; // closing the tab or reloading
}

/** True if it is fine to go on: nothing is unsaved, or the person agreed to lose it. */
export function confirmLeave(): boolean {
  if (dirty.size === 0) return true;
  if (window.confirm(MESSAGE)) {
    dirty.clear();
    window.onbeforeunload = null;
    return true;
  }
  return false;
}
