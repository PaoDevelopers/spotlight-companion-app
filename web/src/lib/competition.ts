import type { CompetitionKind } from "./types";

export const KINDS: { value: CompetitionKind; label: string; hint: string }[] = [
  { value: "individual", label: "Individual", hint: "Each student enters and is scored on their own." },
  { value: "team", label: "Teams", hint: "Students enter under a team name; the team is ranked." },
  { value: "house", label: "Houses", hint: "Students compete for Spring, Summer, Autumn or Winter; house points are added up." },
];
export const kindLabel = (k: string) => KINDS.find((x) => x.value === k)?.label ?? k;
