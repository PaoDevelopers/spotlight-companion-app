import { pgTable, pgEnum, serial, text, timestamp, integer, boolean, jsonb, unique, index } from "drizzle-orm/pg-core";

export const role = pgEnum("role", ["student", "teacher", "admin"]);
export const subject = pgEnum("subject", ["physics", "cs", "both"]);
export const checkinMethod = pgEnum("checkin_method", ["qr", "pass", "nfc", "manual"]);
export const entryStatus = pgEnum("entry_status", ["registered", "competing", "advanced", "eliminated", "finished"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  className: text("class_name"),
  role: role("role").notNull().default("student"),
  loginCodeHash: text("login_code_hash"),
  showOnLeaderboard: boolean("show_on_leaderboard").notNull().default(false),
});

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  subject: subject("subject").notNull(),
  description: text("description").notNull().default(""),
  venue: text("venue"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  capacity: integer("capacity"),
});

export const checkins = pgTable(
  "checkins",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    method: checkinMethod("method").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.eventId, t.userId), index("checkins_user_idx").on(t.userId)],
);

export const competitions = pgTable("competitions", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isTeam: boolean("is_team").notNull().default(false),
});

export const competitionEntries = pgTable(
  "competition_entries",
  {
    id: serial("id").primaryKey(),
    competitionId: integer("competition_id").notNull().references(() => competitions.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    teamName: text("team_name"),
    status: entryStatus("status").notNull().default("registered"),
    score: integer("score"),
    rank: integer("rank"),
    notes: text("notes"),
  },
  (t) => [unique().on(t.competitionId, t.userId)],
);

export const exhibits = pgTable("exhibits", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  subject: subject("subject").notNull(),
  summary: text("summary").notNull().default(""),
  bodyMd: text("body_md").notNull().default(""),
  imageUrl: text("image_url"),
});

export const exhibitVisits = pgTable(
  "exhibit_visits",
  {
    id: serial("id").primaryKey(),
    exhibitId: integer("exhibit_id").notNull().references(() => exhibits.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.exhibitId, t.userId)],
);

// Peer votes for "Most Creative" (target is an exhibit/project). One vote per voter per category.
export const votes = pgTable(
  "votes",
  {
    id: serial("id").primaryKey(),
    category: text("category").notNull(),
    exhibitId: integer("exhibit_id").notNull().references(() => exhibits.id, { onDelete: "cascade" }),
    voterId: integer("voter_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [unique().on(t.category, t.voterId)],
);

export const judgeScores = pgTable(
  "judge_scores",
  {
    id: serial("id").primaryKey(),
    category: text("category").notNull(),
    exhibitId: integer("exhibit_id").notNull().references(() => exhibits.id, { onDelete: "cascade" }),
    judgeId: integer("judge_id").notNull().references(() => users.id),
    score: integer("score").notNull(), // 0-100 rubric total
  },
  (t) => [unique().on(t.category, t.exhibitId, t.judgeId)],
);

export const awards = pgTable("awards", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(), // participation | explorer | creative | ...
  title: text("title").notNull(),
  config: jsonb("config").notNull().default({}),
});

export const awardResults = pgTable("award_results", {
  id: serial("id").primaryKey(),
  awardId: integer("award_id").notNull().references(() => awards.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  rank: integer("rank").notNull(),
  metrics: jsonb("metrics").notNull().default({}),
  published: boolean("published").notNull().default(false),
});

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  actorId: integer("actor_id").references(() => users.id),
  action: text("action").notNull(),
  detail: jsonb("detail").notNull().default({}),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

// Students credited for an exhibit/project (receive the "Most Creative" prize).
export const exhibitOwners = pgTable(
  "exhibit_owners",
  {
    exhibitId: integer("exhibit_id").notNull().references(() => exhibits.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [unique().on(t.exhibitId, t.userId)],
);
