// The same browser tests run against two backends: the original Next.js app and the Go server.
//   npm run test:e2e        -> Next.js (default)
//   npm run test:e2e:go     -> ./spotlight (build it first with `make`)
export const GO = process.env.E2E_BACKEND === "go";
export const ORIGIN = process.env.E2E_ORIGIN ?? "http://localhost:3100";
export const SECRET = process.env.E2E_SECRET ?? "dev-only-secret"; // must match the server's CHECKIN_SECRET

/** URL of the rotating projector token for an event (teacher only). */
export const tokenPath = (eventId: number) => (GO ? `/api/admin/events/${eventId}/token` : `/api/admin/token/${eventId}`);
export const csvPath = (eventId: number) => (GO ? `/api/admin/events/${eventId}/attendees.csv` : `/api/admin/events/${eventId}/csv`);
