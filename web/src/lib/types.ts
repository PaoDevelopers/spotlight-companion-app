// Shapes of the JSON the Go server returns. Keep in sync with docs/API.md.
export type Role = "student" | "teacher" | "admin";
export type Subject = "physics" | "chemistry" | "cs" | "both";

export interface User {
  id: number;
  email: string;
  name: string;
  className: string;
  role: Role;
  showOnLeaderboard: boolean;
}
export interface Me extends User {
  passToken: string;
  /** Set while an admin is looking at the app as this student: the admin's name. */
  viewingAs?: string;
  /** True only for the admins who may "view as a student". */
  canImpersonate?: boolean;
}
export interface Event {
  id: number;
  title: string;
  subject: Subject;
  description: string;
  venue: string | null;
  startsAt: string;
  endsAt: string;
  capacity: number | null;
  imageUrl: string | null;
  host: string | null;
  signupEnabled: boolean;
  signupCount: number;
  competition: CompetitionKind | null;
}
export type CompetitionKind = "individual" | "team" | "house";
export interface Signup {
  userId: number;
  name: string;
  email: string;
  className: string;
  byStaff: boolean;
  at: string;
  checkedIn: boolean;
}
export interface StudentHit {
  id: number;
  name: string;
  email: string;
  className: string;
}
/** A named group of installations, such as "Physics Exhibition". */
export interface Exhibition {
  id: number;
  title: string;
  subject: Subject;
  summary: string;
  bodyMd: string;
  imageUrl: string | null;
  total: number;
  visited: number;
}
export interface Exhibit {
  exhibitionId: number | null;
  id: number;
  slug: string;
  title: string;
  subject: Subject;
  summary: string;
  bodyMd: string;
  imageUrl: string | null;
}
/** An award as the student who received it sees it (published only). */
export interface MyAward {
  id: number;
  title: string;
  reason: string;
}
/** An award as a teacher sees it: one row per student, drafts included. */
export interface Award extends MyAward {
  userId: number;
  name: string;
  className: string;
  published: boolean;
}
export interface AwardGroup {
  title: string;
  winners: { label: string; reason?: string }[];
}
export interface MyCompetition {
  entryId: number;
  eventId: number;
  competition: string;
  event: string;
  kind: CompetitionKind;
  team: string | null;
  house: string | null;
  status: string;
  score: number | null;
  rank: number | null;
}
export interface Entry {
  id: number;
  competitionId: number;
  userId: number;
  name: string;
  className: string;
  teamName: string | null;
  house: string | null;
  status: string;
  score: number | null;
  rank: number | null;
  notes: string | null;
}
export interface Attendee {
  userId: number;
  name: string;
  className: string;
  method: string;
  at: string;
}
export interface ScanResult {
  ok: boolean;
  message: string;
  href?: string;
  /** When check-in is closed: "early" (not open yet) or "late" (over), with the event and when it opens. */
  reason?: "early" | "late";
  event?: string;
  opensAt?: string;
}

export interface BoardRow {
  id: number;
  label: string;
  team: string | null;
  house: string | null;
  status: string;
  score: number | null;
  rank: number | null;
}
export interface BoardGroup {
  label: string;
  rank: number | null;
  score: number | null;
  count: number;
  members?: string[];
}
export interface Board {
  id: number;
  eventId: number;
  name: string;
  event: string;
  kind: CompetitionKind;
  rows: BoardRow[];
  groups: BoardGroup[];
}

// ---- library, scavenger hunts, shared works ----
export interface Book {
  id: number;
  title: string;
  author: string;
  subject: Subject;
  summary: string;
  bodyMd: string;
  imageUrl: string | null;
  reads: number;
  comments: number;
  iRead: boolean;
}
export interface BookComment {
  id: number;
  userId: number;
  name: string;
  className: string;
  body: string;
  at: string;
}
export interface Work {
  id: number;
  userId: number;
  name: string;
  className: string;
  imageUrl: string;
  caption: string;
  at: string;
}
export interface HuntPhoto {
  id: number;
  imageUrl: string;
  caption: string;
  at: string;
}
export interface HuntStage {
  id: number;
  position: number;
  title: string;
  state: "done" | "current" | "locked";
  clue?: string;
  doneAt: string | null;
  method: "code" | "qr" | "teacher" | null;
  photos: HuntPhoto[];
}
export interface HuntRank {
  rank: number;
  label: string;
  at: string;
  me: boolean;
}
export interface Hunt {
  id: number;
  title: string;
  subject: Subject;
  description: string;
  imageUrl: string | null;
  published: boolean;
  stages: number;
}
export interface HuntView extends Hunt {
  stageList: HuntStage[];
  done: number;
  total: number;
  finished: boolean;
  finishedAt: string | null;
  rank: number | null;
  board: HuntRank[];
}
export interface StageOutcome {
  result: "done" | "already" | "locked" | "wrong";
  message: string;
  done: number;
  total: number;
  finished: boolean;
}
export interface HuntStageAdmin {
  id: number;
  position: number;
  title: string;
  clue: string;
  answers: string[];
  token: string;
  url: string;
}
export interface HuntResultStage {
  stageId: number;
  position: number;
  title: string;
  at: string | null;
  method: string | null;
  photos: HuntPhoto[];
}
export interface HuntResultRow {
  userId: number;
  name: string;
  className: string;
  done: number;
  total: number;
  rank: number | null;
  finished: boolean;
  finishedAt: string | null;
  stages: HuntResultStage[];
}
