// Reporting.
//
// Four questions, and nothing else. A hiring dashboard that shows twenty numbers
// is one nobody reads, so this answers only what a team acts on:
//
//   1. What is in front of me right now?          (the dashboard)
//   2. Where do candidates come from, and which sources actually convert?
//   3. Where does the pipeline lose people?
//   4. How long does this take?
//
// Every number here is derived from the tables the app already writes. Nothing
// is precomputed, because at hiring volumes the query is cheap and a stale
// counter is worse than no counter.

import { createRoute, z } from "@clawnify/app";
import { get, query } from "../db.js";
import { ok, type App } from "../env.js";
import { actorId } from "../activity.js";

export function registerReports(app: App) {
  const dashboard = createRoute({
    method: "get",
    path: "/api/dashboard",
    tags: ["Reports"],
    summary: "What needs attention today",
    description: "The home screen: open jobs, new applicants, this week's interviews, your tasks, and anyone stuck.",
    responses: {
      200: ok(
        "The dashboard",
        z.object({
          open_jobs: z.number().int(),
          published_jobs: z.number().int(),
          active_candidates: z.number().int(),
          new_this_week: z.number().int(),
          awaiting_screening: z.number().int(),
          flagged: z.number().int(),
          overdue: z.number().int(),
          my_tasks: z.number().int(),
          jobs: z.array(z.record(z.unknown())),
          interviews: z.array(z.record(z.unknown())),
          tasks: z.array(z.record(z.unknown())),
        }),
      ),
    },
  });

  app.openapi(dashboard, async (c) => {
    const one = async (sql: string, params: unknown[] = []) => (await get<{ n: number }>(sql, params))?.n ?? 0;

    const openJobs = await one("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('draft','published')");
    const publishedJobs = await one("SELECT COUNT(*) AS n FROM jobs WHERE status = 'published'");
    const activeCandidates = await one("SELECT COUNT(*) AS n FROM applications WHERE status = 'active'");
    const newThisWeek = await one("SELECT COUNT(*) AS n FROM applications WHERE applied_at >= datetime('now', '-7 days')");
    const awaitingScreening = await one(
      `SELECT COUNT(*) AS n FROM applications a
        WHERE a.status = 'active' AND NOT EXISTS (SELECT 1 FROM screening_results r WHERE r.application_id = a.id)
          AND EXISTS (SELECT 1 FROM screening_criteria k WHERE k.job_id = a.job_id)`,
    );
    const flagged = await one("SELECT COUNT(*) AS n FROM applications WHERE status = 'active' AND flagged_reason != ''");
    // Overdue is the number this dashboard exists for: candidates are rarely
    // rejected, they are forgotten, and this is the only place that shows it.
    const overdue = await one(
      `SELECT COUNT(*) AS n FROM applications a JOIN job_stages s ON s.id = a.stage_id
        WHERE a.status = 'active' AND s.sla_days > 0
          AND julianday('now') - julianday(a.stage_entered_at) > s.sla_days`,
    );
    const myTasks = await one("SELECT COUNT(*) AS n FROM tasks WHERE done_at IS NULL AND assignee_id = ?", [actorId(c)]);

    const jobs = await query<Record<string, unknown>>(
      `SELECT j.id, j.title, j.slug, j.status, j.department,
              (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.status = 'active') AS active_count,
              (SELECT COUNT(*) FROM applications a JOIN job_stages s ON s.id = a.stage_id
                WHERE a.job_id = j.id AND a.status = 'active' AND s.kind IN ('applied','sourced')) AS new_count
         FROM jobs j WHERE j.status IN ('draft','published')
        ORDER BY new_count DESC, j.created_at DESC LIMIT 8`,
    );
    const interviews = await query<Record<string, unknown>>(
      `SELECT i.id, i.title, i.starts_at, i.location, i.kind, c.name AS candidate_name, j.title AS job_title
         FROM interviews i
         JOIN applications a ON a.id = i.application_id
         JOIN candidates c ON c.id = a.candidate_id
         JOIN jobs j ON j.id = a.job_id
        WHERE i.status = 'scheduled' AND i.starts_at >= datetime('now', '-1 day')
        ORDER BY i.starts_at LIMIT 8`,
    );
    const tasks = await query<Record<string, unknown>>(
      `SELECT t.id, t.title, t.due_at, c.name AS candidate_name
         FROM tasks t LEFT JOIN candidates c ON c.id = t.candidate_id
        WHERE t.done_at IS NULL
        ORDER BY t.due_at IS NULL, t.due_at LIMIT 8`,
    );

    return c.json({
      open_jobs: openJobs,
      published_jobs: publishedJobs,
      active_candidates: activeCandidates,
      new_this_week: newThisWeek,
      awaiting_screening: awaitingScreening,
      flagged,
      overdue,
      my_tasks: myTasks,
      jobs,
      interviews,
      tasks,
    } as never);
  });

  const reports = createRoute({
    method: "get",
    path: "/api/reports",
    tags: ["Reports"],
    summary: "Hiring numbers over a period",
    description:
      "Sources, pipeline conversion, time to hire and volume over time. `job_id` narrows everything to one role.",
    request: {
      query: z.object({
        job_id: z.string().optional(),
        days: z.string().optional().openapi({ description: "Window in days (default 365, max 1095)" }),
      }),
    },
    responses: {
      200: ok(
        "The report",
        z.object({
          window_days: z.number().int(),
          totals: z.object({
            candidates: z.number().int(),
            hired: z.number().int(),
            disqualified: z.number().int(),
            active: z.number().int(),
          }),
          time_to_hire_days: z.number().nullable(),
          sources: z.array(
            z.object({ source: z.string(), candidates: z.number().int(), hired: z.number().int(), hire_rate: z.number() }),
          ),
          funnel: z.array(z.object({ stage: z.string(), position: z.number().int(), reached: z.number().int() })),
          disqualify_reasons: z.array(z.object({ reason: z.string(), count: z.number().int() })),
          over_time: z.array(z.object({ month: z.string(), candidates: z.number().int(), hired: z.number().int() })),
          jobs: z.array(z.record(z.unknown())),
        }),
      ),
    },
  });

  app.openapi(reports, async (c) => {
    const q = c.req.valid("query");
    const days = Math.min(1095, Math.max(1, Number(q.days) || 365));
    const jobFilter = q.job_id ? " AND a.job_id = ?" : "";
    const jobParam = q.job_id ? [q.job_id] : [];
    const since = `-${days} days`;

    const totals = await get<{ candidates: number; hired: number; disqualified: number; active: number }>(
      `SELECT COUNT(*) AS candidates,
              SUM(CASE WHEN a.status = 'hired' THEN 1 ELSE 0 END) AS hired,
              SUM(CASE WHEN a.status = 'disqualified' THEN 1 ELSE 0 END) AS disqualified,
              SUM(CASE WHEN a.status = 'active' THEN 1 ELSE 0 END) AS active
         FROM applications a
        WHERE a.applied_at >= datetime('now', ?)${jobFilter}`,
      [since, ...jobParam],
    );

    // Measured on the applications that actually reached a hire. Averaging in
    // the ones still open would report a time to hire that falls whenever a new
    // application arrives, which is the wrong direction.
    const tth = await get<{ avg_days: number | null }>(
      `SELECT AVG(julianday(a.hired_at) - julianday(a.applied_at)) AS avg_days
         FROM applications a
        WHERE a.hired_at IS NOT NULL AND a.hired_at >= datetime('now', ?)${jobFilter}`,
      [since, ...jobParam],
    );

    const sources = await query<{ source: string; candidates: number; hired: number }>(
      `SELECT a.source AS source, COUNT(*) AS candidates,
              SUM(CASE WHEN a.status = 'hired' THEN 1 ELSE 0 END) AS hired
         FROM applications a
        WHERE a.applied_at >= datetime('now', ?)${jobFilter}
        GROUP BY a.source ORDER BY candidates DESC LIMIT 20`,
      [since, ...jobParam],
    );

    // "Reached" rather than "is standing in": a funnel built from current
    // position counts a hired candidate only in the last column and makes every
    // earlier stage look like it leaks. The activity log is what knows a person
    // passed through a stage, so it is what the funnel is read from — with the
    // current position folded in for anyone who has not moved yet.
    const funnel = await query<{ stage: string; position: number; reached: number }>(
      `SELECT s.name AS stage, s.position AS position, COUNT(DISTINCT a.id) AS reached
         FROM job_stages s
         JOIN applications a ON a.job_id = s.job_id
        WHERE a.applied_at >= datetime('now', ?)${jobFilter}
          AND (
            a.stage_id = s.id
            OR EXISTS (
              SELECT 1 FROM activity v
               WHERE v.application_id = a.id AND v.kind IN ('stage_changed','hired')
                 AND json_extract(v.detail_json, '$.to') = s.name
            )
            OR s.position <= COALESCE((SELECT position FROM job_stages WHERE id = a.stage_id), -1)
          )
        GROUP BY s.name, s.position ORDER BY s.position`,
      [since, ...jobParam],
    );

    const reasons = await query<{ reason: string; count: number }>(
      `SELECT a.disqualify_reason AS reason, COUNT(*) AS count
         FROM applications a
        WHERE a.status = 'disqualified' AND a.disqualify_reason != ''
          AND a.disqualified_at >= datetime('now', ?)${jobFilter}
        GROUP BY a.disqualify_reason ORDER BY count DESC LIMIT 20`,
      [since, ...jobParam],
    );

    const overTime = await query<{ month: string; candidates: number; hired: number }>(
      `SELECT strftime('%Y-%m', a.applied_at) AS month, COUNT(*) AS candidates,
              SUM(CASE WHEN a.status = 'hired' THEN 1 ELSE 0 END) AS hired
         FROM applications a
        WHERE a.applied_at >= datetime('now', ?)${jobFilter}
        GROUP BY month ORDER BY month LIMIT 36`,
      [since, ...jobParam],
    );

    const jobs = await query<Record<string, unknown>>(
      `SELECT j.id, j.title, j.status,
              (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) AS candidates,
              (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.status = 'hired') AS hired,
              (SELECT COALESCE(SUM(v.views), 0) FROM job_views v WHERE v.job_id = j.id) AS views
         FROM jobs j WHERE j.status != 'archived'
        ORDER BY candidates DESC LIMIT 50`,
    );

    return c.json({
      window_days: days,
      totals: {
        candidates: totals?.candidates ?? 0,
        hired: totals?.hired ?? 0,
        disqualified: totals?.disqualified ?? 0,
        active: totals?.active ?? 0,
      },
      time_to_hire_days: tth?.avg_days == null ? null : Math.round(tth.avg_days * 10) / 10,
      sources: sources.map((s) => ({
        ...s,
        hire_rate: s.candidates ? Math.round((s.hired / s.candidates) * 1000) / 10 : 0,
      })),
      funnel,
      disqualify_reasons: reasons,
      over_time: overTime,
      jobs,
    } as never);
  });
}
