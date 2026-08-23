// Applications: the pipeline board, moving people through it, and the two
// decisions that end a process — disqualifying and hiring.
//
// Every one of those is a human action recorded against a named person. The
// agent can screen and recommend; it cannot move anybody, and there is no route
// here that lets it. That is enforced by `requireHuman` below rather than by a
// note in the documentation.

import { createRoute, z } from "@clawnify/app";
import { caller } from "@clawnify/app";
import { get, query, run } from "../db.js";
import { fail, ok, PaginationQuery, paginate, uid, type App } from "../env.js";
import { actorId, actorName, log } from "../activity.js";
import type { Context } from "hono";

const ApplicationSchema = z
  .object({
    id: z.string(),
    job_id: z.string(),
    candidate_id: z.string(),
    stage_id: z.string().nullable(),
    status: z.string(),
    disqualify_reason: z.string(),
    disqualified_at: z.string().nullable(),
    flagged_reason: z.string(),
    source: z.string(),
    applied_at: z.string(),
    stage_entered_at: z.string(),
    hired_at: z.string().nullable(),
    rating_avg: z.number().nullable(),
    rating_count: z.number().int(),
    candidate_name: z.string().optional(),
    candidate_email: z.string().optional(),
    candidate_headline: z.string().optional(),
    job_title: z.string().optional(),
    stage_name: z.string().optional(),
    stage_kind: z.string().optional(),
    days_in_stage: z.number().int().optional(),
    overdue: z.number().int().optional(),
    tags: z.array(z.string()).optional(),
    screened: z.number().int().optional(),
    must_have_met: z.number().int().optional(),
    must_have_total: z.number().int().optional(),
  })
  .openapi("Application");

/**
 * Refuse an action that only a person may take.
 *
 * The agent screens and recommends; advancing, rejecting and hiring are human
 * acts. Under the EU AI Act a deployer of a high-risk system has to keep a human
 * in the decision, and a rule that lives only in a prompt is not a control — a
 * model that misreads its instructions would move people. So the routes that
 * change someone's fate check the caller, and the agent gets a straight refusal
 * telling it what to do instead.
 */
function requireHuman(c: Context): Response | null {
  const who = caller(c);
  if (who === "agent" || who === "agent-browser") {
    return c.json(
      {
        error:
          "Only a person can move, reject or hire a candidate. Post your screening verdicts and tell the user what you found — they decide.",
      },
      403,
    );
  }
  return null;
}

/**
 * Blind screening: how far into the pipeline identity stays hidden.
 *
 * Returns the stage position below which a candidate's name is withheld, or 0
 * when the setting is off.
 */
async function blindBelow(): Promise<number> {
  const s = await get<{ blind_until_position: number }>("SELECT blind_until_position FROM settings WHERE id = 1");
  return s?.blind_until_position ?? 0;
}

/** A stable, non-identifying handle for a masked candidate. */
function maskName(applicationId: string): string {
  return `Candidate ${applicationId.slice(0, 4).toUpperCase()}`;
}

export function registerApplications(app: App) {
  // ── The board ───────────────────────────────────────────────────────

  const board = createRoute({
    method: "get",
    path: "/api/jobs/{id}/board",
    tags: ["Pipeline"],
    summary: "One job's pipeline, grouped by stage",
    description:
      "The kanban view. Returns each stage with the active applications standing in it. Disqualified people are not here — ask for them with the applications list and `status=disqualified`.",
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({
        limit: z.string().optional().openapi({ description: "Cards per stage (default 50, max 100)" }),
      }),
    },
    responses: {
      200: ok(
        "The board",
        z.object({
          job: z.object({ id: z.string(), title: z.string(), status: z.string() }),
          blind: z.boolean(),
          stages: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              kind: z.string(),
              color: z.string(),
              position: z.number().int(),
              sla_days: z.number().int(),
              total: z.number().int(),
              applications: z.array(ApplicationSchema),
            }),
          ),
          disqualified: z.number().int(),
        }),
      ),
      404: fail("No such job"),
    },
  });

  app.openapi(board, async (c) => {
    const { id } = c.req.valid("param");
    const perStage = Math.min(100, Math.max(1, Number(c.req.valid("query").limit) || 50));
    const job = await get<{ id: string; title: string; status: string }>(
      "SELECT id, title, status FROM jobs WHERE id = ?",
      [id],
    );
    if (!job) return c.json({ error: "No such job" } as never, 404);

    const blindPosition = await blindBelow();
    const stages = await query<{ id: string; name: string; kind: string; color: string; position: number; sla_days: number }>(
      "SELECT id, name, kind, color, position, sla_days FROM job_stages WHERE job_id = ? ORDER BY position",
      [id],
    );

    const out = [];
    for (const stage of stages) {
      const rows = await query<Record<string, unknown>>(
        `SELECT a.*, c.name AS candidate_name, c.email AS candidate_email, c.headline AS candidate_headline,
                CAST(julianday('now') - julianday(a.stage_entered_at) AS INTEGER) AS days_in_stage,
                (SELECT COUNT(*) FROM screening_results r WHERE r.application_id = a.id) AS screened,
                (SELECT COUNT(*) FROM screening_results r
                   JOIN screening_criteria k ON k.id = r.criterion_id
                  WHERE r.application_id = a.id AND k.weight = 'must_have'
                    AND r.verdict = 'met' AND r.status != 'rejected') AS must_have_met,
                (SELECT COUNT(*) FROM screening_criteria k WHERE k.job_id = a.job_id AND k.weight = 'must_have') AS must_have_total
           FROM applications a
           JOIN candidates c ON c.id = a.candidate_id
          WHERE a.job_id = ? AND a.stage_id = ? AND a.status IN ('active', 'hired')
          ORDER BY a.stage_entered_at
          LIMIT ?`,
        [id, stage.id, perStage],
      );
      const total = await get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM applications WHERE job_id = ? AND stage_id = ? AND status IN ('active','hired')",
        [id, stage.id],
      );

      const applications = [];
      for (const row of rows) {
        const tags = await query<{ tag: string }>("SELECT tag FROM candidate_tags WHERE candidate_id = ?", [
          String(row.candidate_id),
        ]);
        const days = Number(row.days_in_stage ?? 0);
        const masked = blindPosition > 0 && stage.position < blindPosition;
        applications.push({
          ...row,
          candidate_name: masked ? maskName(String(row.id)) : row.candidate_name,
          candidate_email: masked ? "" : row.candidate_email,
          candidate_headline: masked ? "" : row.candidate_headline,
          tags: tags.map((t) => t.tag),
          overdue: stage.sla_days > 0 && days > stage.sla_days ? 1 : 0,
        });
      }
      out.push({ ...stage, total: total?.n ?? 0, applications });
    }

    const disqualified = await get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM applications WHERE job_id = ? AND status = 'disqualified'",
      [id],
    );
    return c.json({ job, blind: blindPosition > 0, stages: out, disqualified: disqualified?.n ?? 0 } as never);
  });

  // ── The list ────────────────────────────────────────────────────────

  const listApplications = createRoute({
    method: "get",
    path: "/api/jobs/{id}/applications",
    tags: ["Pipeline"],
    summary: "A job's applications as a list",
    description:
      "The screener's second call. `screened=false` narrows to the people nobody has assessed yet, which is the set worth reading.",
    request: {
      params: z.object({ id: z.string() }),
      query: PaginationQuery.extend({
        status: z.enum(["active", "disqualified", "hired", "withdrawn"]).optional(),
        stage_id: z.string().optional(),
        stage_kind: z.enum(["sourced", "applied", "custom", "hired"]).optional(),
        screened: z.enum(["true", "false"]).optional().openapi({ description: "Whether screening verdicts exist yet" }),
        flagged: z.enum(["true", "false"]).optional(),
        search: z.string().optional(),
      }),
    },
    responses: {
      200: ok(
        "A page of applications",
        z.object({ applications: z.array(ApplicationSchema), total: z.number().int(), page: z.number().int() }),
      ),
      404: fail("No such job"),
    },
  });

  app.openapi(listApplications, async (c) => {
    const { id } = c.req.valid("param");
    const q = c.req.valid("query");
    const { limit, offset, page } = paginate(q);
    if (!(await get<{ id: string }>("SELECT id FROM jobs WHERE id = ?", [id]))) {
      return c.json({ error: "No such job" } as never, 404);
    }

    const where = ["a.job_id = ?"];
    const params: unknown[] = [id];
    if (q.status) {
      where.push("a.status = ?");
      params.push(q.status);
    } else {
      where.push("a.status IN ('active','hired')");
    }
    if (q.stage_id) {
      where.push("a.stage_id = ?");
      params.push(q.stage_id);
    }
    if (q.stage_kind) {
      where.push("s.kind = ?");
      params.push(q.stage_kind);
    }
    if (q.screened === "true") where.push("EXISTS (SELECT 1 FROM screening_results r WHERE r.application_id = a.id)");
    if (q.screened === "false") where.push("NOT EXISTS (SELECT 1 FROM screening_results r WHERE r.application_id = a.id)");
    if (q.flagged === "true") where.push("a.flagged_reason != ''");
    if (q.search) {
      where.push("(c.name LIKE ? OR c.email LIKE ? OR c.headline LIKE ?)");
      params.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`);
    }
    const whereSQL = ` WHERE ${where.join(" AND ")}`;
    const from = ` FROM applications a JOIN candidates c ON c.id = a.candidate_id LEFT JOIN job_stages s ON s.id = a.stage_id`;

    const applications = await query<Record<string, unknown>>(
      `SELECT a.*, c.name AS candidate_name, c.email AS candidate_email, c.headline AS candidate_headline,
              s.name AS stage_name, s.kind AS stage_kind, s.position AS stage_position, s.sla_days,
              CAST(julianday('now') - julianday(a.stage_entered_at) AS INTEGER) AS days_in_stage
       ${from}${whereSQL}
        ORDER BY a.applied_at DESC, a.id
        LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const total = await get<{ n: number }>(`SELECT COUNT(*) AS n${from}${whereSQL}`, params);

    const blindPosition = await blindBelow();
    const shaped = applications.map((row) => {
      const masked = blindPosition > 0 && Number(row.stage_position ?? 0) < blindPosition;
      const days = Number(row.days_in_stage ?? 0);
      const sla = Number(row.sla_days ?? 0);
      return {
        ...row,
        candidate_name: masked ? maskName(String(row.id)) : row.candidate_name,
        candidate_email: masked ? "" : row.candidate_email,
        candidate_headline: masked ? "" : row.candidate_headline,
        overdue: sla > 0 && days > sla ? 1 : 0,
      };
    });

    return c.json({ applications: shaped, total: total?.n ?? 0, page } as never);
  });

  const getApplication = createRoute({
    method: "get",
    path: "/api/applications/{id}",
    tags: ["Pipeline"],
    summary: "One application with its job, candidate, criteria and answers",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: ok(
        "The application",
        ApplicationSchema.extend({
          job: z.record(z.unknown()),
          candidate: z.record(z.unknown()),
          criteria: z.array(z.record(z.unknown())),
          answers: z.array(z.record(z.unknown())),
          stages: z.array(z.record(z.unknown())),
        }),
      ),
      404: fail("No such application"),
    },
  });

  app.openapi(getApplication, async (c) => {
    const { id } = c.req.valid("param");
    const application = await get<Record<string, unknown>>(
      `SELECT a.*, s.name AS stage_name, s.kind AS stage_kind,
              CAST(julianday('now') - julianday(a.stage_entered_at) AS INTEGER) AS days_in_stage
         FROM applications a LEFT JOIN job_stages s ON s.id = a.stage_id
        WHERE a.id = ?`,
      [id],
    );
    if (!application) return c.json({ error: "No such application" } as never, 404);

    const job = await get<Record<string, unknown>>("SELECT * FROM jobs WHERE id = ?", [application.job_id]);
    const candidate = await get<Record<string, unknown>>("SELECT * FROM candidates WHERE id = ?", [
      application.candidate_id,
    ]);
    const criteria = await query<Record<string, unknown>>(
      "SELECT * FROM screening_criteria WHERE job_id = ? ORDER BY position",
      [application.job_id],
    );
    const answers = await query<Record<string, unknown>>(
      `SELECT q.id AS question_id, q.prompt, q.type, q.knockout_value, COALESCE(v.value, '') AS value
         FROM job_questions q
         LEFT JOIN application_answers v ON v.question_id = q.id AND v.application_id = ?
        WHERE q.job_id = ? ORDER BY q.position`,
      [id, application.job_id],
    );
    const stages = await query<Record<string, unknown>>(
      "SELECT id, name, kind, position, color FROM job_stages WHERE job_id = ? ORDER BY position",
      [application.job_id],
    );

    return c.json({ ...application, job, candidate, criteria, answers, stages } as never);
  });

  // ── Moving people ───────────────────────────────────────────────────

  const moveStage = createRoute({
    method: "post",
    path: "/api/applications/{id}/stage",
    tags: ["Pipeline"],
    summary: "Move a candidate to another stage",
    description:
      "People only. An agent calling this is refused — screening produces a recommendation, and advancing someone is a decision a person makes and is recorded as having made.",
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { "application/json": { schema: z.object({ stage_id: z.string() }) } } },
    },
    responses: {
      200: ok("The moved application", ApplicationSchema.extend({ actions_run: z.array(z.string()) })),
      403: fail("Only a person can move a candidate"),
      404: fail("No such application or stage"),
    },
  });

  app.openapi(moveStage, async (c) => {
    const refusal = requireHuman(c);
    if (refusal) return refusal as never;

    const { id } = c.req.valid("param");
    const { stage_id } = c.req.valid("json");

    const application = await get<{ id: string; job_id: string; candidate_id: string; stage_id: string | null; status: string }>(
      "SELECT id, job_id, candidate_id, stage_id, status FROM applications WHERE id = ?",
      [id],
    );
    if (!application) return c.json({ error: "No such application" } as never, 404);
    const stage = await get<{ id: string; name: string; kind: string; job_id: string }>(
      "SELECT id, name, kind, job_id FROM job_stages WHERE id = ?",
      [stage_id],
    );
    if (!stage || stage.job_id !== application.job_id) {
      return c.json({ error: "That stage belongs to a different job" } as never, 404);
    }
    const from = application.stage_id
      ? await get<{ name: string }>("SELECT name FROM job_stages WHERE id = ?", [application.stage_id])
      : null;

    // Reaching the terminal stage is the hire. Making it a side effect of the
    // move rather than a separate button is what stops a board full of people
    // parked in "Hired" who were never recorded as hired.
    const hired = stage.kind === "hired";
    await run(
      `UPDATE applications
          SET stage_id = ?, stage_entered_at = datetime('now'), updated_at = datetime('now'),
              status = ?, hired_at = ${hired ? "COALESCE(hired_at, datetime('now'))" : "hired_at"}
        WHERE id = ?`,
      [stage_id, hired ? "hired" : application.status === "hired" ? "active" : application.status, id],
    );

    await log(c, {
      kind: hired ? "hired" : "stage_changed",
      applicationId: id,
      candidateId: application.candidate_id,
      jobId: application.job_id,
      summary: hired ? `Hired — moved to ${stage.name}` : `Moved from ${from?.name ?? "—"} to ${stage.name}`,
      detail: { from: from?.name ?? null, to: stage.name },
    });

    const actions = await runStageActions(c, id, application.candidate_id, stage_id);

    const after = await get<Record<string, unknown>>("SELECT * FROM applications WHERE id = ?", [id]);
    return c.json({ ...after, actions_run: actions } as never);
  });

  const disqualify = createRoute({
    method: "post",
    path: "/api/applications/{id}/disqualify",
    tags: ["Pipeline"],
    summary: "Disqualify a candidate, with a reason",
    description:
      "People only. The reason is required — a rejection with no recorded reason cannot be explained to the person it was about, and the pattern of reasons across a job is the most useful thing in the reports.",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              reason: z.string().min(1).openapi({ description: "A disqualify_reasons id, or free text" }),
              note: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: { 200: ok("The disqualified application", ApplicationSchema), 403: fail("Only a person can reject a candidate"), 404: fail("No such application") },
  });

  app.openapi(disqualify, async (c) => {
    const refusal = requireHuman(c);
    if (refusal) return refusal as never;

    const { id } = c.req.valid("param");
    const { reason, note } = c.req.valid("json");
    const application = await get<{ id: string; job_id: string; candidate_id: string }>(
      "SELECT id, job_id, candidate_id FROM applications WHERE id = ?",
      [id],
    );
    if (!application) return c.json({ error: "No such application" } as never, 404);

    const known = await get<{ label: string }>("SELECT label FROM disqualify_reasons WHERE id = ?", [reason]);
    const label = known?.label ?? reason;

    await run(
      `UPDATE applications
          SET status = 'disqualified', disqualify_reason = ?, disqualified_at = datetime('now'),
              disqualified_by = ?, updated_at = datetime('now')
        WHERE id = ?`,
      [label, actorName(c), id],
    );
    await refreshRetention(application.candidate_id);

    await log(c, {
      kind: "disqualified",
      applicationId: id,
      candidateId: application.candidate_id,
      jobId: application.job_id,
      summary: `Disqualified — ${label}`,
      detail: { reason: label, note: note ?? "" },
    });

    const after = await get<Record<string, unknown>>("SELECT * FROM applications WHERE id = ?", [id]);
    return c.json(after as never);
  });

  const restore = createRoute({
    method: "post",
    path: "/api/applications/{id}/restore",
    tags: ["Pipeline"],
    summary: "Put a disqualified candidate back in the pipeline",
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: ok("The restored application", ApplicationSchema), 403: fail("Only a person can do this"), 404: fail("No such application") },
  });

  app.openapi(restore, async (c) => {
    const refusal = requireHuman(c);
    if (refusal) return refusal as never;

    const { id } = c.req.valid("param");
    const application = await get<{ id: string; job_id: string; candidate_id: string }>(
      "SELECT id, job_id, candidate_id FROM applications WHERE id = ?",
      [id],
    );
    if (!application) return c.json({ error: "No such application" } as never, 404);

    await run(
      `UPDATE applications SET status = 'active', disqualify_reason = '', disqualified_at = NULL,
              disqualified_by = '', stage_entered_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?`,
      [id],
    );
    await refreshRetention(application.candidate_id);
    await log(c, {
      kind: "restored",
      applicationId: id,
      candidateId: application.candidate_id,
      jobId: application.job_id,
      summary: "Put back in the pipeline",
    });

    const after = await get<Record<string, unknown>>("SELECT * FROM applications WHERE id = ?", [id]);
    return c.json(after as never);
  });

  const bulk = createRoute({
    method: "post",
    path: "/api/applications/bulk",
    tags: ["Pipeline"],
    summary: "Move or disqualify several candidates at once",
    description:
      "The one place where doing this to many people at a time is offered, and it still records a separate log entry per person — a bulk rejection is fifty individual decisions, and the record has to be able to show each one.",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              application_ids: z.array(z.string()).min(1).max(200),
              action: z.enum(["move", "disqualify", "tag"]),
              stage_id: z.string().optional(),
              reason: z.string().optional(),
              tag: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: ok("What happened", z.object({ updated: z.number().int(), skipped: z.array(z.object({ id: z.string(), reason: z.string() })) })),
      403: fail("Only a person can do this"),
      422: fail("Missing the argument that action needs"),
    },
  });

  app.openapi(bulk, async (c) => {
    const refusal = requireHuman(c);
    if (refusal) return refusal as never;

    const body = c.req.valid("json");
    if (body.action === "move" && !body.stage_id) return c.json({ error: "move needs a stage_id" } as never, 422);
    if (body.action === "disqualify" && !body.reason) return c.json({ error: "disqualify needs a reason" } as never, 422);
    if (body.action === "tag" && !body.tag) return c.json({ error: "tag needs a tag" } as never, 422);

    const skipped: { id: string; reason: string }[] = [];
    let updated = 0;

    for (const id of body.application_ids) {
      const application = await get<{ id: string; job_id: string; candidate_id: string; status: string }>(
        "SELECT id, job_id, candidate_id, status FROM applications WHERE id = ?",
        [id],
      );
      if (!application) {
        skipped.push({ id, reason: "no such application" });
        continue;
      }

      if (body.action === "move") {
        const stage = await get<{ id: string; name: string; kind: string; job_id: string }>(
          "SELECT id, name, kind, job_id FROM job_stages WHERE id = ?",
          [body.stage_id!],
        );
        if (!stage || stage.job_id !== application.job_id) {
          skipped.push({ id, reason: "that stage belongs to a different job" });
          continue;
        }
        const hired = stage.kind === "hired";
        await run(
          `UPDATE applications SET stage_id = ?, stage_entered_at = datetime('now'), updated_at = datetime('now'),
                  status = ?, hired_at = ${hired ? "COALESCE(hired_at, datetime('now'))" : "hired_at"}
            WHERE id = ?`,
          [body.stage_id, hired ? "hired" : "active", id],
        );
        await log(c, {
          kind: hired ? "hired" : "stage_changed",
          applicationId: id,
          candidateId: application.candidate_id,
          jobId: application.job_id,
          summary: `Moved to ${stage.name}`,
          detail: { to: stage.name, bulk: true },
        });
        await runStageActions(c, id, application.candidate_id, body.stage_id!);
      } else if (body.action === "disqualify") {
        const known = await get<{ label: string }>("SELECT label FROM disqualify_reasons WHERE id = ?", [body.reason!]);
        const label = known?.label ?? body.reason!;
        await run(
          `UPDATE applications SET status = 'disqualified', disqualify_reason = ?, disqualified_at = datetime('now'),
                  disqualified_by = ?, updated_at = datetime('now') WHERE id = ?`,
          [label, actorName(c), id],
        );
        await refreshRetention(application.candidate_id);
        await log(c, {
          kind: "disqualified",
          applicationId: id,
          candidateId: application.candidate_id,
          jobId: application.job_id,
          summary: `Disqualified — ${label}`,
          detail: { reason: label, bulk: true },
        });
      } else {
        await run("INSERT OR IGNORE INTO candidate_tags (candidate_id, tag) VALUES (?, ?)", [
          application.candidate_id,
          body.tag!,
        ]);
      }
      updated++;
    }

    return c.json({ updated, skipped } as never);
  });

  const answer = createRoute({
    method: "put",
    path: "/api/applications/{id}/answers",
    tags: ["Pipeline"],
    summary: "Record answers to the job's application questions",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({ answers: z.array(z.object({ question_id: z.string(), value: z.string() })) }),
          },
        },
      },
    },
    responses: { 200: ok("Saved", z.object({ ok: z.boolean(), flagged_reason: z.string() })), 404: fail("No such application") },
  });

  app.openapi(answer, async (c) => {
    const { id } = c.req.valid("param");
    const { answers } = c.req.valid("json");
    const application = await get<{ id: string; job_id: string }>("SELECT id, job_id FROM applications WHERE id = ?", [id]);
    if (!application) return c.json({ error: "No such application" } as never, 404);

    for (const a of answers) {
      await run(
        "INSERT INTO application_answers (application_id, question_id, value) VALUES (?, ?, ?) ON CONFLICT (application_id, question_id) DO UPDATE SET value = excluded.value",
        [id, a.question_id, a.value],
      );
    }
    const flagged = await applyKnockouts(id, application.job_id);
    return c.json({ ok: true, flagged_reason: flagged } as never);
  });

  // ── Reference data ──────────────────────────────────────────────────

  const reasons = createRoute({
    method: "get",
    path: "/api/disqualify-reasons",
    tags: ["Pipeline"],
    summary: "The reasons a candidate can be disqualified",
    responses: {
      200: ok("The reasons", z.object({ reasons: z.array(z.object({ id: z.string(), label: z.string() })) })),
    },
  });

  // A fixed list of ten. The small reference set that may return every row.
  app.openapi(reasons, async (c) => {
    const rows = await query<{ id: string; label: string }>(
      "SELECT id, label FROM disqualify_reasons ORDER BY position LIMIT 100",
    );
    return c.json({ reasons: rows } as never);
  });
}

/**
 * Compare the answers against the job's knockout values and set (or clear) the
 * flag.
 *
 * It flags. It does not reject. An answer that fails a knockout is a strong
 * signal and a bad decision-maker: the question "do you have the right to work
 * in Germany?" is answered "no" by people who are three weeks from a permit, and
 * a rejection sent by a machine to that person is both a worse hire and the
 * decision GDPR Art. 22 says they may insist a human makes. So it surfaces the
 * mismatch at the top of the pipeline and lets someone spend the four seconds.
 */
export async function applyKnockouts(applicationId: string, jobId: string): Promise<string> {
  const rows = await query<{ prompt: string; knockout_value: string; value: string }>(
    `SELECT q.prompt, q.knockout_value, COALESCE(v.value, '') AS value
       FROM job_questions q
       LEFT JOIN application_answers v ON v.question_id = q.id AND v.application_id = ?
      WHERE q.job_id = ? AND q.knockout_value != ''`,
    [applicationId, jobId],
  );
  const misses = rows
    .filter((r) => r.value.trim().toLowerCase() === r.knockout_value.trim().toLowerCase())
    .map((r) => r.prompt);

  const reason = misses.length ? `Answered “${misses[0]}” in a way this job screens out` : "";
  await run("UPDATE applications SET flagged_reason = ? WHERE id = ?", [reason, applicationId]);
  return reason;
}

/**
 * Start the retention clock for a candidate whose processes have all ended.
 *
 * A person still in an active pipeline has no expiry — you cannot delete someone
 * you are about to interview. The clock starts when their last application
 * closes, which is the moment the reason for holding their data ends, and it is
 * cleared again if they re-enter a process.
 */
export async function refreshRetention(candidateId: string): Promise<void> {
  const open = await get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM applications WHERE candidate_id = ? AND status IN ('active','hired')",
    [candidateId],
  );
  if ((open?.n ?? 0) > 0) {
    await run("UPDATE candidates SET retain_until = NULL WHERE id = ?", [candidateId]);
    return;
  }
  const s = await get<{ retention_days: number }>("SELECT retention_days FROM settings WHERE id = 1");
  const days = s?.retention_days ?? 180;
  await run(`UPDATE candidates SET retain_until = date('now', '+' || ? || ' days') WHERE id = ?`, [days, candidateId]);
}

/**
 * Run whatever the stage says happens on arrival.
 *
 * Returns a human-readable list of what it did, because an automation whose
 * effects are invisible is one nobody trusts and everybody turns off. Each
 * effect is logged as `system` so the audit trail distinguishes a rule's work
 * from a person's.
 */
export async function runStageActions(
  c: Context,
  applicationId: string,
  candidateId: string,
  stageId: string,
): Promise<string[]> {
  const actions = await query<{ kind: string; config: string }>(
    "SELECT kind, config FROM stage_actions WHERE stage_id = ? ORDER BY position",
    [stageId],
  );
  const done: string[] = [];

  for (const action of actions) {
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(action.config) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (action.kind === "task" && config.title) {
      const dueDays = Number(config.due_days ?? 0);
      await run(
        `INSERT INTO tasks (id, application_id, candidate_id, title, due_at, created_by)
         VALUES (?, ?, ?, ?, ${dueDays > 0 ? "date('now', '+' || ? || ' days')" : "NULL"}, 'system')`,
        dueDays > 0
          ? [uid(), applicationId, candidateId, String(config.title), dueDays]
          : [uid(), applicationId, candidateId, String(config.title)],
      );
      done.push(`Created the task “${String(config.title)}”`);
    } else if (action.kind === "tag" && config.tag) {
      await run("INSERT OR IGNORE INTO candidate_tags (candidate_id, tag) VALUES (?, ?)", [candidateId, String(config.tag)]);
      done.push(`Tagged “${String(config.tag)}”`);
    } else if (action.kind === "message" && config.template_id) {
      // Drafted, never sent. See the note on stage_actions in schema.sql: an
      // unattended message to a person is the one automation you cannot undo.
      const template = await get<{ name: string }>("SELECT name FROM message_templates WHERE id = ?", [
        String(config.template_id),
      ]);
      if (template) {
        await run(
          "INSERT INTO tasks (id, application_id, candidate_id, title, created_by) VALUES (?, ?, ?, ?, 'system')",
          [uid(), applicationId, candidateId, `Send “${template.name}”`],
        );
        done.push(`Queued “${template.name}” for you to send`);
      }
    }
  }

  if (done.length) {
    await log(c, {
      kind: "stage_changed",
      applicationId,
      candidateId,
      summary: done.join("; "),
      actor: { kind: "system", name: "Stage automation" },
    });
  }
  return done;
}

/** Exposed so the public apply route can record who created a record. */
export { actorId };
