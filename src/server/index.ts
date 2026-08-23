// Open Recruit — the API.
//
// `createApp` brings the OpenAPI router, the per-request database wiring, and
// the two discovery routes (`/api/openapi.json`, `/llms.txt`) that let the org's
// agent learn this API without anyone documenting it twice. Everything below is
// this app's own surface, grouped by what it is for.

import { createApp } from "@clawnify/app";
import type { Env } from "./env.js";
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
