// A page with edits that have not been saved says so here, so leaving it can ask first. It is a plain module-level flag
// because the places that navigate (the nav bar, the Back button, links) are far from the form that knows.

let unsaved = false;
const MESSAGE = "You have changes that are not saved yet. Leave without saving?";

export function setUnsaved(v: boolean) {
  unsaved = v;
  window.onbeforeunload = v ? (e) => { e.preventDefault(); return MESSAGE; } : null; // closing the tab or reloading
}

/** True if it is fine to go on: nothing is unsaved, or the person agreed to lose it. */
export function confirmLeave(): boolean {
  if (!unsaved) return true;
  if (window.confirm(MESSAGE)) {
    setUnsaved(false);
    return true;
  }
  return false;
}
