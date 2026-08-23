// Jobs, their pipeline, their application-form questions and their screening
// criteria — everything that is decided once per role, before anyone applies.

import { createRoute, z } from "@clawnify/app";
import { get, query, run } from "../db.js";
import { fail, ok, PaginationQuery, paginate, slugify, uid, type App } from "../env.js";
import { log } from "../activity.js";

/**
 * The stages a new job starts with when no template is chosen.
 *
 * A pipeline is the one thing a hiring team will not sit down and design before
 * posting their first role, so shipping a blank board guarantees a board nobody
 * uses. These five are the shape every ATS converges on; the point is that they
 * are editable, not that they are right.
 */
export const DEFAULT_STAGES: { name: string; kind: string; color: string }[] = [
  { name: "Applied", kind: "applied", color: "#64748b" },
  { name: "Screening", kind: "custom", color: "#2563eb" },
  { name: "Interview", kind: "custom", color: "#0d9488" },
  { name: "Offer", kind: "custom", color: "#7c3aed" },
  { name: "Hired", kind: "hired", color: "#047857" },
];

const JobSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    department: z.string(),
    team: z.string(),
    employment_type: z.string(),
    experience_level: z.string(),
    workplace: z.string(),
    location_city: z.string(),
    location_region: z.string(),
    location_country: z.string(),
    location_postal: z.string(),
    remote_region: z.string(),
    description_md: z.string(),
    requirements_md: z.string(),
    benefits_md: z.string(),
    salary_min: z.number().int().nullable(),
    salary_max: z.number().int().nullable(),
    salary_currency: z.string(),
    salary_unit: z.string(),
    salary_public: z.number().int(),
    headcount: z.number().int(),
    status: z.string(),
    hiring_manager: z.string(),
    published_at: z.string().nullable(),
    closes_at: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    application_count: z.number().int().optional(),
    active_count: z.number().int().optional(),
    hired_count: z.number().int().optional(),
    new_count: z.number().int().optional(),
  })
  .openapi("Job");

const StageSchema = z
  .object({
    id: z.string(),
    job_id: z.string(),
    position: z.number().int(),
    name: z.string(),
    kind: z.string(),
    color: z.string(),
    count: z.number().int().optional(),
  })
  .openapi("Stage");

const CriterionSchema = z
  .object({
    id: z.string(),
    job_id: z.string(),
    position: z.number().int(),
    key: z.string(),
    label: z.string(),
    detail: z.string(),
    weight: z.string(),
    type: z.string(),
    options: z.string(),
  })
  .openapi("Criterion");

const QuestionSchema = z
  .object({
    id: z.string(),
    job_id: z.string(),
    position: z.number().int(),
    prompt: z.string(),
    type: z.string(),
    options: z.string(),
    required: z.number().int(),
    knockout_value: z.string(),
  })
  .openapi("Question");

const EMPLOYMENT_TYPES = [
  "FULL_TIME",
  "PART_TIME",
  "CONTRACTOR",
  "TEMPORARY",
  "INTERN",
  "VOLUNTEER",
  "PER_DIEM",
  "OTHER",
] as const;

const JobInput = z.object({
  title: z.string().min(1),
  department: z.string().optional(),
  team: z.string().optional(),
  employment_type: z.enum(EMPLOYMENT_TYPES).optional(),
  experience_level: z.string().optional(),
  workplace: z.enum(["onsite", "hybrid", "remote"]).optional(),
  location_city: z.string().optional(),
  location_region: z.string().optional(),
  location_country: z
    .string()
    .optional()
    .openapi({ description: "ISO 3166-1 alpha-2, e.g. DE. Required for the job to appear in structured data." }),
  location_postal: z.string().optional(),
  remote_region: z.string().optional(),
  description_md: z.string().optional(),
  requirements_md: z.string().optional(),
  benefits_md: z.string().optional(),
  salary_min: z.number().int().nullable().optional(),
  salary_max: z.number().int().nullable().optional(),
  salary_currency: z.string().optional(),
  salary_unit: z.enum(["HOUR", "DAY", "WEEK", "MONTH", "YEAR"]).optional(),
  salary_public: z.boolean().optional(),
  headcount: z.number().int().min(1).optional(),
  hiring_manager: z.string().optional(),
  closes_at: z.string().nullable().optional(),
});

async function uniqueSlug(base: string, exceptId?: string): Promise<string> {
  let slug = base;
  for (let n = 2; n < 200; n++) {
    const clash = await get<{ id: string }>("SELECT id FROM jobs WHERE slug = ?", [slug]);
    if (!clash || clash.id === exceptId) return slug;
    slug = `${base}-${n}`;
  }
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

export function registerJobs(app: App) {
  // ── Jobs ────────────────────────────────────────────────────────────

  const listJobs = createRoute({
    method: "get",
    path: "/api/jobs",
    tags: ["Jobs"],
    summary: "List jobs, newest first",
    request: {
      query: PaginationQuery.extend({
        search: z.string().optional().openapi({ description: "Free-text match on title or department" }),
        status: z.enum(["draft", "published", "closed", "archived"]).optional(),
      }),
    },
    responses: {
      200: ok("A page of jobs", z.object({ jobs: z.array(JobSchema), total: z.number().int(), page: z.number().int() })),
    },
  });

  app.openapi(listJobs, async (c) => {
    const q = c.req.valid("query");
    const { limit, offset, page } = paginate(q);

    const where: string[] = [];
    const params: unknown[] = [];
    if (q.search) {
      where.push("(j.title LIKE ? OR j.department LIKE ?)");
      params.push(`%${q.search}%`, `%${q.search}%`);
    }
    if (q.status) {
      where.push("j.status = ?");
      params.push(q.status);
    } else {
      where.push("j.status != 'archived'");
    }
    const whereSQL = ` WHERE ${where.join(" AND ")}`;

    const jobs = await query<Record<string, unknown>>(
      `SELECT j.*,
              (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) AS application_count,
              (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.status = 'active') AS active_count,
              (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.status = 'hired') AS hired_count,
              (SELECT COUNT(*) FROM applications a
                 JOIN job_stages s ON s.id = a.stage_id
                WHERE a.job_id = j.id AND a.status = 'active' AND s.kind = 'applied') AS new_count
         FROM jobs j${whereSQL}
        ORDER BY j.created_at DESC, j.id
        LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const total = await get<{ n: number }>(`SELECT COUNT(*) AS n FROM jobs j${whereSQL}`, params);

    return c.json({ jobs, total: total?.n ?? 0, page } as never);
  });

  const createJob = createRoute({
    method: "post",
    path: "/api/jobs",
    tags: ["Jobs"],
    summary: "Open a new job",
    description:
      "Creates the job as a draft with a pipeline. Pass `pipeline_template_id` to start from a saved pipeline, otherwise the default five stages are created.",
    request: {
      body: {
        content: {
          "application/json": {
            schema: JobInput.extend({ pipeline_template_id: z.string().optional() }),
          },
        },
      },
    },
    responses: { 201: ok("The created job", JobSchema) },
  });

  app.openapi(createJob, async (c) => {
    const body = c.req.valid("json");
    const id = uid();
    const slug = await uniqueSlug(slugify(body.title));

    await run(
      `INSERT INTO jobs (id, slug, title, department, team, employment_type, experience_level, workplace,
                         location_city, location_region, location_country, location_postal, remote_region,
                         description_md, requirements_md, benefits_md,
                         salary_min, salary_max, salary_currency, salary_unit, salary_public,
                         headcount, hiring_manager, closes_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        slug,
        body.title,
        body.department ?? "",
        body.team ?? "",
        body.employment_type ?? "FULL_TIME",
        body.experience_level ?? "",
        body.workplace ?? "onsite",
        body.location_city ?? "",
        body.location_region ?? "",
        (body.location_country ?? "").toUpperCase(),
        body.location_postal ?? "",
        body.remote_region ?? "",
        body.description_md ?? "",
        body.requirements_md ?? "",
        body.benefits_md ?? "",
        body.salary_min ?? null,
        body.salary_max ?? null,
        body.salary_currency ?? "EUR",
        body.salary_unit ?? "YEAR",
        body.salary_public ? 1 : 0,
        body.headcount ?? 1,
        body.hiring_manager ?? "",
        body.closes_at ?? null,
        "",
      ],
    );

    let stages = DEFAULT_STAGES;
    if (body.pipeline_template_id) {
      const tpl = await get<{ stages_json: string }>("SELECT stages_json FROM pipeline_templates WHERE id = ?", [
        body.pipeline_template_id,
      ]);
      if (tpl) {
        const parsed = JSON.parse(tpl.stages_json) as typeof DEFAULT_STAGES;
        if (Array.isArray(parsed) && parsed.length) stages = parsed;
      }
    }
    await createStages(id, stages);

    await log(c, { kind: "job", jobId: id, summary: `Opened the job “${body.title}”` });

    const job = await get<Record<string, unknown>>("SELECT * FROM jobs WHERE id = ?", [id]);
    return c.json(job as never, 201);
  });

  const getJob = createRoute({
    method: "get",
    path: "/api/jobs/{id}",
    tags: ["Jobs"],
    summary: "One job with its pipeline and counts",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: ok(
        "The job",
        JobSchema.extend({ stages: z.array(StageSchema), criteria: z.array(CriterionSchema), questions: z.array(QuestionSchema) }),
      ),
      404: fail("No such job"),
    },
  });

  app.openapi(getJob, async (c) => {
    const { id } = c.req.valid("param");
    const job = await get<Record<string, unknown>>(
      `SELECT j.*,
              (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) AS application_count,
              (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.status = 'active') AS active_count,
              (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.status = 'hired') AS hired_count
         FROM jobs j WHERE j.id = ?`,
      [id],
    );
    if (!job) return c.json({ error: "No such job" } as never, 404);

    const stages = await query<Record<string, unknown>>(
      `SELECT s.*, (SELECT COUNT(*) FROM applications a WHERE a.stage_id = s.id AND a.status = 'active') AS count
         FROM job_stages s WHERE s.job_id = ? ORDER BY s.position`,
      [id],
    );
    const criteria = await query<Record<string, unknown>>(
      "SELECT * FROM screening_criteria WHERE job_id = ? ORDER BY position",
      [id],
    );
    const questions = await query<Record<string, unknown>>(
      "SELECT * FROM job_questions WHERE job_id = ? ORDER BY position",
      [id],
    );
    return c.json({ ...job, stages, criteria, questions } as never);
  });

  const updateJob = createRoute({
    method: "patch",
    path: "/api/jobs/{id}",
    tags: ["Jobs"],
    summary: "Edit a job, or publish and close it",
    description:
      "Publishing sets `published_at` and puts the job on the public careers site. Closing takes it down but keeps the pipeline.",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: JobInput.partial().extend({
              slug: z.string().optional(),
              status: z.enum(["draft", "published", "closed", "archived"]).optional(),
            }),
          },
        },
      },
    },
    responses: { 200: ok("The updated job", JobSchema), 404: fail("No such job") },
  });

  app.openapi(updateJob, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const before = await get<{ id: string; title: string; status: string }>(
      "SELECT id, title, status FROM jobs WHERE id = ?",
      [id],
    );
    if (!before) return c.json({ error: "No such job" } as never, 404);

    const sets: string[] = [];
    const params: unknown[] = [];
    const scalar = [
      "title",
      "department",
      "team",
      "employment_type",
      "experience_level",
      "workplace",
      "location_city",
      "location_region",
      "location_postal",
      "remote_region",
      "description_md",
      "requirements_md",
      "benefits_md",
      "salary_min",
      "salary_max",
      "salary_currency",
      "salary_unit",
      "headcount",
      "hiring_manager",
      "closes_at",
      "status",
    ] as const;
    for (const field of scalar) {
      if (body[field] !== undefined) {
        sets.push(`${field} = ?`);
        params.push(body[field]);
      }
    }
    if (body.location_country !== undefined) {
      sets.push("location_country = ?");
      params.push(body.location_country.toUpperCase());
    }
    if (body.salary_public !== undefined) {
      sets.push("salary_public = ?");
      params.push(body.salary_public ? 1 : 0);
    }
    if (body.slug !== undefined) {
      sets.push("slug = ?");
      params.push(await uniqueSlug(slugify(body.slug), id));
    }
    // First publish stamps the date; re-publishing a job that was closed keeps
    // the original, because "posted on" is what an aggregator sorts by and
    // resetting it every time someone reopens a role is how a stale posting
    // keeps claiming to be new.
    if (body.status === "published") sets.push("published_at = COALESCE(published_at, datetime('now'))");

    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      await run(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
    }

    if (body.status && body.status !== before.status) {
      await log(c, {
        kind: "job",
        jobId: id,
        summary: `${before.title} is now ${body.status}`,
        detail: { from: before.status, to: body.status },
      });
    }

    const job = await get<Record<string, unknown>>("SELECT * FROM jobs WHERE id = ?", [id]);
    return c.json(job as never);
  });

  const deleteJob = createRoute({
    method: "delete",
    path: "/api/jobs/{id}",
    tags: ["Jobs"],
    summary: "Delete a job and its applications",
    description:
      "Candidates themselves are not deleted — a person may have applied elsewhere or sit in a talent pool. Prefer archiving unless the job was a mistake.",
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: ok("Deleted", z.object({ ok: z.boolean() })), 404: fail("No such job") },
  });

  app.openapi(deleteJob, async (c) => {
    const { id } = c.req.valid("param");
    const job = await get<{ id: string }>("SELECT id FROM jobs WHERE id = ?", [id]);
    if (!job) return c.json({ error: "No such job" } as never, 404);
    await run("DELETE FROM jobs WHERE id = ?", [id]);
    return c.json({ ok: true } as never);
  });

  // ── Stages ──────────────────────────────────────────────────────────

  const addStage = createRoute({
    method: "post",
    path: "/api/jobs/{id}/stages",
    tags: ["Jobs"],
    summary: "Add a stage to a job's pipeline",
    description: "New stages land before the hired stage, which always stays last.",
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { "application/json": { schema: z.object({ name: z.string().min(1), color: z.string().optional() }) } } },
    },
    responses: { 201: ok("The created stage", StageSchema), 404: fail("No such job") },
  });

  app.openapi(addStage, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    if (!(await get<{ id: string }>("SELECT id FROM jobs WHERE id = ?", [id]))) {
      return c.json({ error: "No such job" } as never, 404);
    }
    const hired = await get<{ position: number }>(
      "SELECT position FROM job_stages WHERE job_id = ? AND kind = 'hired' ORDER BY position DESC",
      [id],
    );
    const stageId = uid();
    const position = hired ? hired.position : 999;
    if (hired) await run("UPDATE job_stages SET position = position + 1 WHERE job_id = ? AND position >= ?", [id, position]);
    await run("INSERT INTO job_stages (id, job_id, position, name, kind, color) VALUES (?, ?, ?, ?, 'custom', ?)", [
      stageId,
      id,
      position,
      body.name,
      body.color ?? "",
    ]);
    const stage = await get<Record<string, unknown>>("SELECT * FROM job_stages WHERE id = ?", [stageId]);
    return c.json(stage as never, 201);
  });

  const updateStage = createRoute({
    method: "patch",
    path: "/api/stages/{id}",
    tags: ["Jobs"],
    summary: "Rename, recolour or reorder a stage",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({ name: z.string().min(1).optional(), color: z.string().optional(), position: z.number().int().optional() }),
          },
        },
      },
    },
    responses: { 200: ok("The updated stage", StageSchema), 404: fail("No such stage") },
  });

  app.openapi(updateStage, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    if (!(await get<{ id: string }>("SELECT id FROM job_stages WHERE id = ?", [id]))) {
      return c.json({ error: "No such stage" } as never, 404);
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const field of ["name", "color", "position"] as const) {
      if (body[field] !== undefined) {
        sets.push(`${field} = ?`);
        params.push(body[field]);
      }
    }
    if (sets.length) await run(`UPDATE job_stages SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
    const stage = await get<Record<string, unknown>>("SELECT * FROM job_stages WHERE id = ?", [id]);
    return c.json(stage as never);
  });

  const deleteStage = createRoute({
    method: "delete",
    path: "/api/stages/{id}",
    tags: ["Jobs"],
    summary: "Remove a custom stage",
    description:
      "The first and last stages cannot be removed — applying and hiring are defined in terms of them. Anyone standing in the deleted stage moves back one.",
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: ok("Deleted", z.object({ ok: z.boolean(), moved: z.number().int() })), 404: fail("No such stage"), 422: fail("A fixed stage") },
  });

  app.openapi(deleteStage, async (c) => {
    const { id } = c.req.valid("param");
    const stage = await get<{ id: string; job_id: string; kind: string; position: number }>(
      "SELECT id, job_id, kind, position FROM job_stages WHERE id = ?",
      [id],
    );
    if (!stage) return c.json({ error: "No such stage" } as never, 404);
    if (stage.kind !== "custom") {
      return c.json(
        { error: "The first and last stages are fixed — applying and hiring are defined in terms of them." } as never,
        422,
      );
    }
    // Move anyone standing here back rather than leaving them stage-less: an
    // application with no stage does not appear on the board at all, which is
    // how a candidate silently disappears from a pipeline.
    const previous = await get<{ id: string }>(
      "SELECT id FROM job_stages WHERE job_id = ? AND position < ? ORDER BY position DESC",
      [stage.job_id, stage.position],
    );
    const moved = await get<{ n: number }>("SELECT COUNT(*) AS n FROM applications WHERE stage_id = ?", [id]);
    if (previous) {
      await run("UPDATE applications SET stage_id = ?, stage_entered_at = datetime('now') WHERE stage_id = ?", [
        previous.id,
        id,
      ]);
    }
    await run("DELETE FROM job_stages WHERE id = ?", [id]);
    return c.json({ ok: true, moved: moved?.n ?? 0 } as never);
  });

  // ── Screening criteria ──────────────────────────────────────────────

  const listCriteria = createRoute({
    method: "get",
    path: "/api/jobs/{id}/criteria",
    tags: ["Screening"],
    summary: "What this job requires",
    description:
      "The screener's first call. Each criterion has a stable `key` to write verdicts against, a short `label` for the grid, and the `detail` that says what actually counts as meeting it.",
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: ok("The criteria", z.object({ criteria: z.array(CriterionSchema), job: z.object({ id: z.string(), title: z.string() }) })), 404: fail("No such job") },
  });

  app.openapi(listCriteria, async (c) => {
    const { id } = c.req.valid("param");
    const job = await get<{ id: string; title: string }>("SELECT id, title FROM jobs WHERE id = ?", [id]);
    if (!job) return c.json({ error: "No such job" } as never, 404);
    const criteria = await query<Record<string, unknown>>(
      "SELECT * FROM screening_criteria WHERE job_id = ? ORDER BY position",
      [id],
    );
    return c.json({ job, criteria } as never);
  });

  const putCriteria = createRoute({
    method: "put",
    path: "/api/jobs/{id}/criteria",
    tags: ["Screening"],
    summary: "Replace a job's screening criteria",
    description:
      "Sent whole rather than one at a time — the criteria are edited as a list in the UI, and a partial update would leave verdicts pointing at requirements nobody can see.",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              criteria: z.array(
                z.object({
                  key: z
                    .string()
                    .regex(/^[a-z0-9_]+$/, "lowercase letters, digits and underscores only")
                    .openapi({ description: "Stable handle verdicts are written against, e.g. production_kubernetes" }),
                  label: z.string().min(1),
                  detail: z.string().optional().openapi({ description: "What counts as meeting this. The substance belongs here, not in the label." }),
                  weight: z.enum(["must_have", "nice_to_have"]).optional(),
                  type: z.enum(["boolean", "years", "text", "enum"]).optional(),
                  options: z.string().optional(),
                }),
              ),
            }),
          },
        },
      },
    },
    responses: { 200: ok("The saved criteria", z.object({ criteria: z.array(CriterionSchema) })), 404: fail("No such job") },
  });

  app.openapi(putCriteria, async (c) => {
    const { id } = c.req.valid("param");
    const { criteria } = c.req.valid("json");
    if (!(await get<{ id: string }>("SELECT id FROM jobs WHERE id = ?", [id]))) {
      return c.json({ error: "No such job" } as never, 404);
    }
    const keys = new Set(criteria.map((x) => x.key));
    if (keys.size !== criteria.length) {
      return c.json({ error: "Two criteria share a key; each key must be unique within a job." } as never, 404);
    }

    // Deleting the rows a verdict points at cascades those verdicts away, so
    // criteria that survive keep their id — an edit to the wording of a
    // requirement must not erase the screening already done against it.
    const existing = await query<{ id: string; key: string }>("SELECT id, key FROM screening_criteria WHERE job_id = ?", [id]);
    const byKey = new Map(existing.map((r) => [r.key, r.id]));

    for (const row of existing) {
      if (!keys.has(row.key)) await run("DELETE FROM screening_criteria WHERE id = ?", [row.id]);
    }
    for (const [i, x] of criteria.entries()) {
      const existingId = byKey.get(x.key);
      if (existingId) {
        await run(
          "UPDATE screening_criteria SET position = ?, label = ?, detail = ?, weight = ?, type = ?, options = ? WHERE id = ?",
          [i, x.label, x.detail ?? "", x.weight ?? "must_have", x.type ?? "boolean", x.options ?? "", existingId],
        );
      } else {
        await run(
          "INSERT INTO screening_criteria (id, job_id, position, key, label, detail, weight, type, options) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [uid(), id, i, x.key, x.label, x.detail ?? "", x.weight ?? "must_have", x.type ?? "boolean", x.options ?? ""],
        );
      }
    }

    const saved = await query<Record<string, unknown>>(
      "SELECT * FROM screening_criteria WHERE job_id = ? ORDER BY position",
      [id],
    );
    return c.json({ criteria: saved } as never);
  });

  // ── Application-form questions ──────────────────────────────────────

  const putQuestions = createRoute({
    method: "put",
    path: "/api/jobs/{id}/questions",
    tags: ["Jobs"],
    summary: "Replace the questions on a job's application form",
    description:
      "`knockout_value` marks an answer as a mismatch and FLAGS the application for a human. It never rejects anybody — an automated rejection is precisely the decision a person is entitled to have a human make.",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              questions: z.array(
                z.object({
                  prompt: z.string().min(1),
                  type: z.enum(["text", "textarea", "boolean", "single_choice", "multi_choice", "number", "url", "date"]).optional(),
                  options: z.string().optional().openapi({ description: "Newline-separated choices" }),
                  required: z.boolean().optional(),
                  knockout_value: z.string().optional().openapi({ description: "Answer that flags the application for review" }),
                }),
              ),
            }),
          },
        },
      },
    },
    responses: { 200: ok("The saved questions", z.object({ questions: z.array(QuestionSchema) })), 404: fail("No such job") },
  });

  app.openapi(putQuestions, async (c) => {
    const { id } = c.req.valid("param");
    const { questions } = c.req.valid("json");
    if (!(await get<{ id: string }>("SELECT id FROM jobs WHERE id = ?", [id]))) {
      return c.json({ error: "No such job" } as never, 404);
    }
    await run("DELETE FROM job_questions WHERE job_id = ?", [id]);
    for (const [i, q] of questions.entries()) {
      await run(
        "INSERT INTO job_questions (id, job_id, position, prompt, type, options, required, knockout_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [uid(), id, i, q.prompt, q.type ?? "text", q.options ?? "", q.required ? 1 : 0, q.knockout_value ?? ""],
      );
    }
    const saved = await query<Record<string, unknown>>("SELECT * FROM job_questions WHERE job_id = ? ORDER BY position", [id]);
    return c.json({ questions: saved } as never);
  });

  // ── Pipeline templates ──────────────────────────────────────────────

  const listTemplates = createRoute({
    method: "get",
    path: "/api/pipeline-templates",
    tags: ["Jobs"],
    summary: "Saved pipelines",
    responses: {
      200: ok(
        "The templates",
        z.object({
          templates: z.array(
            z.object({ id: z.string(), name: z.string(), description: z.string(), stages_json: z.string(), created_at: z.string() }),
          ),
        }),
      ),
    },
  });

  // A team has a handful of pipelines, not a table of them — this is the small
  // fixed reference set that may return every row.
  app.openapi(listTemplates, async (c) => {
    const templates = await query<Record<string, unknown>>("SELECT * FROM pipeline_templates ORDER BY name LIMIT 100");
    return c.json({ templates } as never);
  });

  const saveTemplate = createRoute({
    method: "post",
    path: "/api/pipeline-templates",
    tags: ["Jobs"],
    summary: "Save a pipeline for reuse",
    description: "Pass `from_job_id` to capture a job's current stages, or `stages` to write one by hand.",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string().min(1),
              description: z.string().optional(),
              from_job_id: z.string().optional(),
              stages: z.array(z.object({ name: z.string(), kind: z.string().optional(), color: z.string().optional() })).optional(),
            }),
          },
        },
      },
    },
    responses: { 201: ok("The saved template", z.object({ id: z.string() })), 404: fail("No such job") },
  });

  app.openapi(saveTemplate, async (c) => {
    const body = c.req.valid("json");
    let stages = body.stages;
    if (body.from_job_id) {
      const rows = await query<{ name: string; kind: string; color: string }>(
        "SELECT name, kind, color FROM job_stages WHERE job_id = ? ORDER BY position",
        [body.from_job_id],
      );
      if (!rows.length) return c.json({ error: "No such job" } as never, 404);
      stages = rows;
    }
    const id = uid();
    await run("INSERT INTO pipeline_templates (id, name, description, stages_json) VALUES (?, ?, ?, ?)", [
      id,
      body.name,
      body.description ?? "",
      JSON.stringify(stages ?? DEFAULT_STAGES),
    ]);
    return c.json({ id } as never, 201);
  });

  const deleteTemplate = createRoute({
    method: "delete",
    path: "/api/pipeline-templates/{id}",
    tags: ["Jobs"],
    summary: "Delete a saved pipeline",
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: ok("Deleted", z.object({ ok: z.boolean() })) },
  });

  app.openapi(deleteTemplate, async (c) => {
    await run("DELETE FROM pipeline_templates WHERE id = ?", [c.req.valid("param").id]);
    return c.json({ ok: true } as never);
  });
}

/** Create a job's stages in order. Exported so the seed path can reuse it. */
export async function createStages(jobId: string, stages: { name: string; kind?: string; color?: string }[]) {
  for (const [i, s] of stages.entries()) {
    await run("INSERT INTO job_stages (id, job_id, position, name, kind, color) VALUES (?, ?, ?, ?, ?, ?)", [
      uid(),
      jobId,
      i,
      s.name,
      s.kind ?? "custom",
      s.color ?? "",
    ]);
  }
}
