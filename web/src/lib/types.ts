// Shapes of the JSON the Go server returns. Keep in sync with docs/API.md.
export type Role = "student" | "teacher" | "admin";
export type Subject = "physics" | "cs" | "both";

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
}
export interface Exhibit {
  id: number;
  slug: string;
  title: string;
  subject: Subject;
  summary: string;
  bodyMd: string;
  imageUrl: string | null;
}
export interface AwardResult {
  id: number;
  award: string;
  key: string;
  rank: number;
  metrics: Record<string, number>;
  userId: number;
  name: string;
  className: string;
  published: boolean;
}
export interface MyCompetition {
  entryId: number;
  competition: string;
  event: string;
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
}
