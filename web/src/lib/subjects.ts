import type { Subject } from "./types";

/** Subjects in the order teachers and students see them. "both" is stored for events that mix several subjects. */
export const SUBJECTS: [Subject, string][] = [
  ["physics", "Physics"],
  ["chemistry", "Chemistry"],
  ["cs", "CS"],
  ["both", "Mixed"],
];
export const subjectLabel = (s: string) => SUBJECTS.find(([v]) => v === s)?.[1] ?? s;
