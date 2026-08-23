// Everything a hiring team does around a candidate rather than to them: notes,
// tasks, scheduled interviews and the evaluations that come out of them.

import { createRoute, z } from "@clawnify/app";
import { get, query, run } from "../db.js";
import { fail, ok, PaginationQuery, paginate, uid, type App } from "../env.js";
import { actorId, actorName, log } from "../activity.js";

const NoteSchema = z
  .object({
    id: z.string(),
    application_id: z.string().nullable(),
    candidate_id: z.string(),
    author_id: z.string(),
    author_name: z.string(),
    body: z.string(),
    visibility: z.string(),
    created_at: z.string(),
  })
  .openapi("Note");

const TaskSchema = z
  .object({
    id: z.string(),
    application_id: z.string().nullable(),
    candidate_id: z.string().nullable(),
    title: z.string(),
    due_at: z.string().nullable(),
    assignee_id: z.string(),
    assignee_name: z.string(),
    done_at: z.string().nullable(),
    created_at: z.string(),
    candidate_name: z.string().optional(),
    job_title: z.string().optional(),
  })
  .openapi("Task");

const InterviewSchema = z
  .object({
    id: z.string(),
    application_id: z.string(),
    stage_id: z.string().nullable(),
    title: z.string(),
    kind: z.string(),
    starts_at: z.string(),
    ends_at: z.string().nullable(),
    location: z.string(),
    interviewers: z.string(),
    notes: z.string(),
    status: z.string(),
    created_at: z.string(),
    candidate_name: z.string().optional(),
    job_title: z.string().optional(),
  })
  .openapi("Interview");

const EvaluationSchema = z
  .object({
    id: z.string(),
    application_id: z.string(),
    interview_id: z.string().nullable(),
    scorecard_id: z.string().nullable(),
    author_id: z.string(),
    author_name: z.string(),
    overall: z.string(),
    summary: z.string(),
    scores_json: z.string(),
    created_at: z.string(),
  })
  .openapi("Evaluation");

export function registerCollaboration(app: App) {
  // ── Notes ───────────────────────────────────────────────────────────

  const listNotes = createRoute({
    method: "get",
    path: "/api/candidates/{id}/notes",
    tags: ["Collaboration"],
    summary: "Notes on a candidate",
    description: "Private notes are only ever returned to the person who wrote them.",
    request: { params: z.object({ id: z.string() }), query: PaginationQuery },
    responses: { 200: ok("A page of notes", z.object({ notes: z.array(NoteSchema), total: z.number().int(), page: z.number().int() })) },
  });

  app.openapi(listNotes, async (c) => {
    const { id } = c.req.valid("param");
    const { limit, offset, page } = paginate(c.req.valid("query"));
    const me = actorId(c);
    // Filtered in SQL rather than after the fetch: a private note that reaches
    // the client and is hidden by the UI has still been disclosed.
    const where = "n.candidate_id = ? AND (n.visibility = 'team' OR n.author_id = ?)";
    const notes = await query<Record<string, unknown>>(
      `SELECT n.* FROM notes n WHERE ${where} ORDER BY n.created_at DESC LIMIT ? OFFSET ?`,
      [id, me, limit, offset],
    );
    const total = await get<{ n: number }>(`SELECT COUNT(*) AS n FROM notes n WHERE ${where}`, [id, me]);
    return c.json({ notes, total: total?.n ?? 0, page } as never);
  });

  const addNote = createRoute({
    method: "post",
    path: "/api/candidates/{id}/notes",
    tags: ["Collaboration"],
    summary: "Leave a note on a candidate",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              body: z.string().min(1),
              application_id: z.string().optional(),
              visibility: z.enum(["team", "private"]).optional(),
            }),
          },
        },
      },
    },
    responses: { 201: ok("The note", NoteSchema), 404: fail("No such candidate") },
  });

  app.openapi(addNote, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    if (!(await get<{ id: string }>("SELECT id FROM candidates WHERE id = ?", [id]))) {
      return c.json({ error: "No such candidate" } as never, 404);
    }
    const noteId = uid();
    await run(
      "INSERT INTO notes (id, application_id, candidate_id, author_id, author_name, body, visibility) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [noteId, body.application_id ?? null, id, actorId(c), actorName(c), body.body, body.visibility ?? "team"],
    );
    // A private note is not team activity, so it does not appear in the feed —
    // logging it would leak its existence to everyone it was hidden from.
    if ((body.visibility ?? "team") === "team") {
      await log(c, {
        kind: "note",
        candidateId: id,
        applicationId: body.application_id ?? null,
        summary: body.body.length > 120 ? `${body.body.slice(0, 119)}…` : body.body,
      });
    }
    const note = await get<Record<string, unknown>>("SELECT * FROM notes WHERE id = ?", [noteId]);
    return c.json(note as never, 201);
  });

  const deleteNote = createRoute({
    method: "delete",
    path: "/api/notes/{id}",
    tags: ["Collaboration"],
    summary: "Delete a note you wrote",
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: ok("Deleted", z.object({ ok: z.boolean() })), 403: fail("Not yours"), 404: fail("No such note") },
  });

  app.openapi(deleteNote, async (c) => {
    const { id } = c.req.valid("param");
    const note = await get<{ author_id: string }>("SELECT author_id FROM notes WHERE id = ?", [id]);
    if (!note) return c.json({ error: "No such note" } as never, 404);
    if (note.author_id && note.author_id !== actorId(c)) {
      return c.json({ error: "You can only delete your own notes." } as never, 403);
    }
    await run("DELETE FROM notes WHERE id = ?", [id]);
    return c.json({ ok: true } as never);
  });

  // ── Tasks ───────────────────────────────────────────────────────────

  const listTasks = createRoute({
    method: "get",
    path: "/api/tasks",
    tags: ["Collaboration"],
    summary: "Open tasks, soonest first",
    request: {
      query: PaginationQuery.extend({
        candidate_id: z.string().optional(),
        done: z.enum(["true", "false"]).optional(),
        mine: z.enum(["true"]).optional(),
      }),
    },
    responses: { 200: ok("A page of tasks", z.object({ tasks: z.array(TaskSchema), total: z.number().int(), page: z.number().int() })) },
  });

  app.openapi(listTasks, async (c) => {
    const q = c.req.valid("query");
    const { limit, offset, page } = paginate(q);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.candidate_id) {
      where.push("t.candidate_id = ?");
      params.push(q.candidate_id);
    }
    if (q.done === "true") where.push("t.done_at IS NOT NULL");
    if (q.done !== "true") where.push("t.done_at IS NULL");
    if (q.mine === "true") {
      where.push("t.assignee_id = ?");
      params.push(actorId(c));
    }
    const whereSQL = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const from = ` FROM tasks t LEFT JOIN candidates c ON c.id = t.candidate_id LEFT JOIN applications a ON a.id = t.application_id LEFT JOIN jobs j ON j.id = a.job_id`;

    const tasks = await query<Record<string, unknown>>(
      `SELECT t.*, c.name AS candidate_name, j.title AS job_title${from}${whereSQL}
        ORDER BY t.due_at IS NULL, t.due_at, t.created_at LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const total = await get<{ n: number }>(`SELECT COUNT(*) AS n${from}${whereSQL}`, params);
    return c.json({ tasks, total: total?.n ?? 0, page } as never);
  });

  const addTask = createRoute({
    method: "post",
    path: "/api/tasks",
    tags: ["Collaboration"],
    summary: "Add a task",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              title: z.string().min(1),
              candidate_id: z.string().optional(),
              application_id: z.string().optional(),
              due_at: z.string().nullable().optional(),
              assignee_id: z.string().optional(),
              assignee_name: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: { 201: ok("The task", TaskSchema) },
  });

  app.openapi(addTask, async (c) => {
    const body = c.req.valid("json");
    const id = uid();
    await run(
      "INSERT INTO tasks (id, application_id, candidate_id, title, due_at, assignee_id, assignee_name, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        body.application_id ?? null,
        body.candidate_id ?? null,
        body.title,
        body.due_at ?? null,
        body.assignee_id ?? actorId(c),
        body.assignee_name ?? actorName(c),
        actorId(c),
      ],
    );
    const task = await get<Record<string, unknown>>("SELECT * FROM tasks WHERE id = ?", [id]);
    return c.json(task as never, 201);
  });

  const updateTask = createRoute({
    method: "patch",
    path: "/api/tasks/{id}",
    tags: ["Collaboration"],
    summary: "Tick a task off, or edit it",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({ title: z.string().optional(), due_at: z.string().nullable().optional(), done: z.boolean().optional() }),
          },
        },
      },
    },
    responses: { 200: ok("The task", TaskSchema), 404: fail("No such task") },
  });

  app.openapi(updateTask, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    if (!(await get<{ id: string }>("SELECT id FROM tasks WHERE id = ?", [id]))) {
      return c.json({ error: "No such task" } as never, 404);
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    if (body.title !== undefined) {
      sets.push("title = ?");
      params.push(body.title);
    }
    if (body.due_at !== undefined) {
      sets.push("due_at = ?");
      params.push(body.due_at);
    }
    if (body.done !== undefined) sets.push(`done_at = ${body.done ? "datetime('now')" : "NULL"}`);
    if (sets.length) await run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
    const task = await get<Record<string, unknown>>("SELECT * FROM tasks WHERE id = ?", [id]);
    return c.json(task as never);
  });

  const deleteTask = createRoute({
    method: "delete",
    path: "/api/tasks/{id}",
    tags: ["Collaboration"],
    summary: "Delete a task",
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: ok("Deleted", z.object({ ok: z.boolean() })) },
  });

  app.openapi(deleteTask, async (c) => {
    await run("DELETE FROM tasks WHERE id = ?", [c.req.valid("param").id]);
    return c.json({ ok: true } as never);
  });

  // ── Interviews ──────────────────────────────────────────────────────

  const listInterviews = createRoute({
    method: "get",
    path: "/api/interviews",
    tags: ["Collaboration"],
    summary: "Scheduled interviews, soonest first",
    request: {
      query: PaginationQuery.extend({
        application_id: z.string().optional(),
        from: z.string().optional().openapi({ description: "ISO date; defaults to now" }),
        to: z.string().optional(),
      }),
    },
    responses: {
      200: ok("A page of interviews", z.object({ interviews: z.array(InterviewSchema), total: z.number().int(), page: z.number().int() })),
    },
  });

  app.openapi(listInterviews, async (c) => {
    const q = c.req.valid("query");
    const { limit, offset, page } = paginate(q);
    const where: string[] = ["i.status != 'cancelled'"];
    const params: unknown[] = [];
    if (q.application_id) {
      where.push("i.application_id = ?");
      params.push(q.application_id);
    } else {
      where.push("i.starts_at >= ?");
      params.push(q.from ?? new Date().toISOString().slice(0, 10));
    }
    if (q.to) {
      where.push("i.starts_at <= ?");
      params.push(q.to);
    }
    const whereSQL = ` WHERE ${where.join(" AND ")}`;
    const from = ` FROM interviews i JOIN applications a ON a.id = i.application_id JOIN candidates c ON c.id = a.candidate_id JOIN jobs j ON j.id = a.job_id`;

    const interviews = await query<Record<string, unknown>>(
      `SELECT i.*, c.name AS candidate_name, j.title AS job_title${from}${whereSQL} ORDER BY i.starts_at LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const total = await get<{ n: number }>(`SELECT COUNT(*) AS n${from}${whereSQL}`, params);
    return c.json({ interviews, total: total?.n ?? 0, page } as never);
  });

  const scheduleInterview = createRoute({
    method: "post",
    path: "/api/applications/{id}/interviews",
    tags: ["Collaboration"],
    summary: "Schedule an interview",
    description:
      "The app records the appointment; it does not send the invitation. Put the meeting link in `location` and the candidate sees it in their message.",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              title: z.string().optional(),
              kind: z.enum(["phone_screen", "interview", "task", "other"]).optional(),
              starts_at: z.string().openapi({ description: "ISO 8601" }),
              ends_at: z.string().nullable().optional(),
              location: z.string().optional(),
              interviewers: z.array(z.object({ id: z.string().optional(), name: z.string() })).optional(),
              notes: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: { 201: ok("The interview", InterviewSchema), 404: fail("No such application") },
  });

  app.openapi(scheduleInterview, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const application = await get<{ id: string; job_id: string; candidate_id: string; stage_id: string | null }>(
      "SELECT id, job_id, candidate_id, stage_id FROM applications WHERE id = ?",
      [id],
    );
    if (!application) return c.json({ error: "No such application" } as never, 404);

    const interviewId = uid();
    await run(
      `INSERT INTO interviews (id, application_id, stage_id, title, kind, starts_at, ends_at, location, interviewers, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        interviewId,
        id,
        application.stage_id,
        body.title ?? "Interview",
        body.kind ?? "interview",
        body.starts_at,
        body.ends_at ?? null,
        body.location ?? "",
        JSON.stringify(body.interviewers ?? []),
        body.notes ?? "",
        actorName(c),
      ],
    );
    await log(c, {
      kind: "interview",
      applicationId: id,
      candidateId: application.candidate_id,
      jobId: application.job_id,
      summary: `${body.title ?? "Interview"} scheduled for ${body.starts_at}`,
    });
    const interview = await get<Record<string, unknown>>("SELECT * FROM interviews WHERE id = ?", [interviewId]);
    return c.json(interview as never, 201);
  });

  const updateInterview = createRoute({
    method: "patch",
    path: "/api/interviews/{id}",
    tags: ["Collaboration"],
    summary: "Reschedule, complete or cancel an interview",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              starts_at: z.string().optional(),
              ends_at: z.string().nullable().optional(),
              location: z.string().optional(),
              notes: z.string().optional(),
              status: z.enum(["scheduled", "done", "cancelled"]).optional(),
            }),
          },
        },
      },
    },
    responses: { 200: ok("The interview", InterviewSchema), 404: fail("No such interview") },
  });

  app.openapi(updateInterview, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    if (!(await get<{ id: string }>("SELECT id FROM interviews WHERE id = ?", [id]))) {
      return c.json({ error: "No such interview" } as never, 404);
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const field of ["starts_at", "ends_at", "location", "notes", "status"] as const) {
      if (body[field] !== undefined) {
        sets.push(`${field} = ?`);
        params.push(body[field]);
      }
    }
    if (sets.length) await run(`UPDATE interviews SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
    const interview = await get<Record<string, unknown>>("SELECT * FROM interviews WHERE id = ?", [id]);
    return c.json(interview as never);
  });

  // ── Evaluations ─────────────────────────────────────────────────────

  const listEvaluations = createRoute({
    method: "get",
    path: "/api/applications/{id}/evaluations",
    tags: ["Collaboration"],
    summary: "Interview feedback on a candidate",
    description:
      "When the deployment hides evaluations, colleagues' feedback is withheld until you have submitted your own — the response says so rather than pretending there is none.",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: ok(
        "The evaluations",
        z.object({
          evaluations: z.array(EvaluationSchema),
          hidden: z.number().int().openapi({ description: "How many are withheld until you submit yours" }),
          mine: z.boolean(),
        }),
      ),
    },
  });

  app.openapi(listEvaluations, async (c) => {
    const { id } = c.req.valid("param");
    const me = actorId(c);
    const settings = await get<{ hide_evaluations: number }>("SELECT hide_evaluations FROM settings WHERE id = 1");
    const all = await query<Record<string, unknown>>(
      "SELECT * FROM evaluations WHERE application_id = ? ORDER BY created_at DESC",
      [id],
    );
    const mine = all.some((e) => e.author_id === me && me !== "");

    // Withheld in the query result, not in the UI. The point of the setting is
    // that the first opinion in the room does not become everybody's, and that
    // only holds if the data never reaches the browser.
    if (settings?.hide_evaluations && !mine && me !== "") {
      return c.json({ evaluations: [], hidden: all.length, mine: false } as never);
    }
    return c.json({ evaluations: all, hidden: 0, mine } as never);
  });

  const addEvaluation = createRoute({
    method: "post",
    path: "/api/applications/{id}/evaluations",
    tags: ["Collaboration"],
    summary: "Submit interview feedback",
    description:
      "`overall` is a four-point scale with no middle, so the answer is a recommendation rather than a shrug. Submitting yours is what unlocks everyone else's.",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              overall: z.enum(["strong_no", "no", "yes", "strong_yes"]),
              summary: z.string().optional(),
              interview_id: z.string().optional(),
              scorecard_id: z.string().optional(),
              scores: z.array(z.object({ key: z.string(), rating: z.number().int().min(1).max(4), comment: z.string().optional() })).optional(),
            }),
          },
        },
      },
    },
    responses: { 201: ok("The evaluation", EvaluationSchema), 404: fail("No such application") },
  });

  app.openapi(addEvaluation, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const application = await get<{ id: string; job_id: string; candidate_id: string; stage_id: string | null }>(
      "SELECT id, job_id, candidate_id, stage_id FROM applications WHERE id = ?",
      [id],
    );
    if (!application) return c.json({ error: "No such application" } as never, 404);

    const evaluationId = uid();
    await run(
      `INSERT INTO evaluations (id, application_id, interview_id, scorecard_id, stage_id, author_id, author_name, overall, summary, scores_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        evaluationId,
        id,
        body.interview_id ?? null,
        body.scorecard_id ?? null,
        application.stage_id,
        actorId(c),
        actorName(c),
        body.overall,
        body.summary ?? "",
        JSON.stringify(body.scores ?? []),
      ],
    );

    // Cache the average on the application so the board can show a signal
    // without a subquery per card. -2..+2 maps the four-point scale onto a
    // number that averages meaningfully with no neutral value to hide in.
    const SCALE: Record<string, number> = { strong_no: -2, no: -1, yes: 1, strong_yes: 2 };
    const all = await query<{ overall: string }>("SELECT overall FROM evaluations WHERE application_id = ?", [id]);
    const scores = all.map((e) => SCALE[e.overall] ?? 0);
    const average = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    await run("UPDATE applications SET rating_avg = ?, rating_count = ? WHERE id = ?", [average, scores.length, id]);

    await log(c, {
      kind: "evaluation",
      applicationId: id,
      candidateId: application.candidate_id,
      jobId: application.job_id,
      summary: `${actorName(c) || "Someone"} evaluated: ${body.overall.replace("_", " ")}`,
      detail: { overall: body.overall },
    });

    const evaluation = await get<Record<string, unknown>>("SELECT * FROM evaluations WHERE id = ?", [evaluationId]);
    return c.json(evaluation as never, 201);
  });

  // ── Scorecards ──────────────────────────────────────────────────────

  const listScorecards = createRoute({
    method: "get",
    path: "/api/scorecards",
    tags: ["Collaboration"],
    summary: "Saved evaluation forms",
    responses: {
      200: ok(
        "The scorecards",
        z.object({ scorecards: z.array(z.object({ id: z.string(), name: z.string(), description: z.string(), criteria_json: z.string() })) }),
      ),
    },
  });

  // A team keeps a handful. The small fixed reference set exception.
  app.openapi(listScorecards, async (c) => {
    const scorecards = await query<Record<string, unknown>>("SELECT * FROM scorecards ORDER BY name LIMIT 100");
    return c.json({ scorecards } as never);
  });

  const saveScorecard = createRoute({
    method: "post",
    path: "/api/scorecards",
    tags: ["Collaboration"],
    summary: "Create an evaluation form",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string().min(1),
              description: z.string().optional(),
              criteria: z.array(z.object({ key: z.string(), label: z.string(), detail: z.string().optional() })),
            }),
          },
        },
      },
    },
    responses: { 201: ok("The scorecard", z.object({ id: z.string() })) },
  });

  app.openapi(saveScorecard, async (c) => {
    const body = c.req.valid("json");
    const id = uid();
    await run("INSERT INTO scorecards (id, name, description, criteria_json) VALUES (?, ?, ?, ?)", [
      id,
      body.name,
      body.description ?? "",
      JSON.stringify(body.criteria),
    ]);
    return c.json({ id } as never, 201);
  });

  const deleteScorecard = createRoute({
    method: "delete",
    path: "/api/scorecards/{id}",
    tags: ["Collaboration"],
    summary: "Delete an evaluation form",
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: ok("Deleted", z.object({ ok: z.boolean() })) },
  });

  app.openapi(deleteScorecard, async (c) => {
    await run("DELETE FROM scorecards WHERE id = ?", [c.req.valid("param").id]);
    return c.json({ ok: true } as never);
  });

  // ── The activity feed ───────────────────────────────────────────────

  const listActivity = createRoute({
    method: "get",
    path: "/api/activity",
    tags: ["Collaboration"],
    summary: "What has been happening",
    description:
      "The audit trail, newest first. Narrow it to one candidate to answer “what happened to this application?” — which is also the question a candidate is entitled to ask.",
    request: {
      query: PaginationQuery.extend({ candidate_id: z.string().optional(), job_id: z.string().optional(), kind: z.string().optional() }),
    },
    responses: {
      200: ok(
        "A page of activity",
        z.object({
          activity: z.array(
            z.object({
              id: z.string(),
              candidate_id: z.string().nullable(),
              application_id: z.string().nullable(),
              job_id: z.string().nullable(),
              kind: z.string(),
              actor_kind: z.string(),
              actor_name: z.string(),
              summary: z.string(),
              detail_json: z.string(),
              created_at: z.string(),
              candidate_name: z.string().nullable().optional(),
              job_title: z.string().nullable().optional(),
            }),
          ),
          total: z.number().int(),
          page: z.number().int(),
        }),
      ),
    },
  });

  app.openapi(listActivity, async (c) => {
    const q = c.req.valid("query");
    const { limit, offset, page } = paginate(q);
    const where: string[] = [];
    const params: unknown[] = [];
    for (const [field, value] of [
      ["candidate_id", q.candidate_id],
      ["job_id", q.job_id],
      ["kind", q.kind],
    ] as const) {
      if (value) {
        where.push(`v.${field} = ?`);
        params.push(value);
      }
    }
    const whereSQL = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const from = " FROM activity v LEFT JOIN candidates c ON c.id = v.candidate_id LEFT JOIN jobs j ON j.id = v.job_id";

    const activity = await query<Record<string, unknown>>(
      `SELECT v.*, c.name AS candidate_name, j.title AS job_title${from}${whereSQL} ORDER BY v.created_at DESC, v.id LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const total = await get<{ n: number }>(`SELECT COUNT(*) AS n${from}${whereSQL}`, params);
    return c.json({ activity, total: total?.n ?? 0, page } as never);
  });
}
