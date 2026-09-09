// Open Recruit — the API.
//
// `createApp` brings the OpenAPI router, the per-request database wiring, and
// the two discovery routes (`/api/openapi.json`, `/llms.txt`) that let the org's
// agent learn this API without anyone documenting it twice. Everything below is
// this app's own surface, grouped by what it is for.

import { createApp } from "@clawnify/app";
import type { Env } from "./env.js";
import { get, run } from "./db.js";
import { registerJobs } from "./routes/jobs.js";
import { registerCandidates } from "./routes/candidates.js";
import { registerApplications } from "./routes/applications.js";
import { registerScreening } from "./routes/screening.js";
import { registerCollaboration } from "./routes/collaboration.js";
import { registerMessages } from "./routes/messages.js";
import { registerReports } from "./routes/reports.js";
import { registerSettings } from "./routes/settings.js";
import { registerPublic } from "./routes/public.js";

const app = createApp<Env>({
  title: "Open Recruit",
  version: "1.0.0",
  description:
    "Applicant tracking with a careers site, a hiring pipeline and evidence-backed screening: every requirement an AI marks as met carries a quote the app has located in the candidate's own CV, and one it cannot find is never shown as a qualification.",
});

// ── First-run rows ──────────────────────────────────────────────────
// These used to be seeded from schema.sql, but a deploy applies that file as
// DDL only and refuses anything else, so the seed failed the whole build.
//
// The settings row: every column carries a DDL default, so an id-only insert
// is the whole row. Without it `SELECT * FROM settings WHERE id = 1` returns
// nothing and `UPDATE settings … WHERE id = 1` matches nothing and reports
// success, so saving the careers-site settings would silently do nothing.
//
// The disqualify reasons: a starter list a team can edit, so they are written
// only while the table is still empty and a deleted one never comes back.
const DISQUALIFY_REASONS: ReadonlyArray<readonly [string, string, number]> = [
  ["not-a-fit", "Not a fit for this role", 1],
  ["underqualified", "Underqualified", 2],
  ["overqualified", "Overqualified", 3],
  ["no-response", "Unresponsive", 4],
  ["withdrew", "Withdrew", 5],
  ["offer-declined", "Declined our offer", 6],
  ["salary", "Compensation mismatch", 7],
  ["location", "Location or work permit", 8],
  ["position-closed", "Position closed", 9],
  ["other", "Other", 10],
];

let seeded = false;

app.use("*", async (_c, next) => {
  if (!seeded) {
    try {
      await run("insert into settings (id) values (1) on conflict (id) do nothing");
      const existing = await get<{ n: number }>("select count(*) as n from disqualify_reasons");
      if ((existing?.n ?? 0) === 0) {
        for (const [id, label, position] of DISQUALIFY_REASONS) {
          await run("insert or ignore into disqualify_reasons (id, label, position) values (?, ?, ?)", [id, label, position]);
        }
      }
      seeded = true;
    } catch {
      // A cold database mid-migration: the next request retries.
    }
  }
  await next();
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || String(err) }, 500);
});

registerJobs(app);
registerCandidates(app);
registerApplications(app);
registerScreening(app);
registerCollaboration(app);
registerMessages(app);
registerReports(app);
registerSettings(app);

// Last, and off the OpenAPI surface: the careers site, the application form and
// the job feed. Registered after the authenticated routes so a public path can
// never shadow one.
registerPublic(app);

export default app;
