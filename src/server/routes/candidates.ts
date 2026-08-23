// Candidates: the person, their files, the text of those files, their tags and
// their talent-pool membership.
//
// A candidate exists independently of any job. That is the difference between an
// ATS and a spreadsheet per role: it is what lets the app answer "have we spoken
// to this person before?", which is the question that saves a team from
// interviewing someone twice and from ignoring the person they already liked.

import { createRoute, z } from "@clawnify/app";
import { get, query, run } from "../db.js";
import { fail, ok, PaginationQuery, paginate, uid, type App } from "../env.js";
import { actorId, actorName, log } from "../activity.js";
import { extract, isSupported, UnsupportedFileError } from "../extract.js";

const CandidateSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    phone: z.string(),
    headline: z.string(),
    location: z.string(),
    links_json: z.string(),
    source: z.string(),
    source_detail: z.string(),
    consent_status: z.string(),
    consent_at: z.string().nullable(),
    retain_until: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    tags: z.array(z.string()).optional(),
    application_count: z.number().int().optional(),
  })
  .openapi("Candidate");

const AttachmentSchema = z
  .object({
    id: z.string(),
    candidate_id: z.string(),
    application_id: z.string().nullable(),
    kind: z.string(),
    name: z.string(),
    mime: z.string(),
    size_bytes: z.number().int(),
    page_count: z.number().int(),
    locator_kind: z.string(),
    extract_status: z.string(),
    extract_error: z.string(),
    created_at: z.string(),
  })
  .openapi("Attachment");

/**
 * Cap on how much text one call returns.
 *
 * A CV is a couple of pages, so the whole thing usually arrives at once — but
 * the caller is an agent paying for every character in its context, and a
 * 40-page portfolio PDF exists. Bounded, with the same shape either way.
 */
const TEXT_PAGE_LIMIT = 10;

export function registerCandidates(app: App) {
  // ── Candidates ──────────────────────────────────────────────────────

  const listCandidates = createRoute({
    method: "get",
    path: "/api/candidates",
    tags: ["Candidates"],
    summary: "Search candidates",
    request: {
      query: PaginationQuery.extend({
        search: z.string().optional().openapi({ description: "Matches name, email or headline" }),
        tag: z.string().optional(),
        pool_id: z.string().optional(),
        source: z.string().optional(),
      }),
    },
    responses: {
      200: ok("A page of candidates", z.object({ candidates: z.array(CandidateSchema), total: z.number().int(), page: z.number().int() })),
    },
  });

  app.openapi(listCandidates, async (c) => {
    const q = c.req.valid("query");
    const { limit, offset, page } = paginate(q);

    const where: string[] = [];
    const params: unknown[] = [];
    if (q.search) {
      where.push("(c.name LIKE ? OR c.email LIKE ? OR c.headline LIKE ?)");
      params.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`);
    }
    if (q.tag) {
      where.push("EXISTS (SELECT 1 FROM candidate_tags t WHERE t.candidate_id = c.id AND t.tag = ?)");
      params.push(q.tag);
    }
    if (q.pool_id) {
      where.push("EXISTS (SELECT 1 FROM talent_pool_members m WHERE m.candidate_id = c.id AND m.pool_id = ?)");
      params.push(q.pool_id);
    }
    if (q.source) {
      where.push("c.source = ?");
      params.push(q.source);
    }
    const whereSQL = where.length ? ` WHERE ${where.join(" AND ")}` : "";

    const candidates = await query<Record<string, unknown>>(
      `SELECT c.*, (SELECT COUNT(*) FROM applications a WHERE a.candidate_id = c.id) AS application_count
         FROM candidates c${whereSQL}
        ORDER BY c.created_at DESC, c.id
        LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const total = await get<{ n: number }>(`SELECT COUNT(*) AS n FROM candidates c${whereSQL}`, params);

    return c.json({ candidates, total: total?.n ?? 0, page } as never);
  });

  const createCandidate = createRoute({
    method: "post",
    path: "/api/candidates",
    tags: ["Candidates"],
    summary: "Add a candidate by hand or from sourcing",
    description:
      "Consent defaults to `unknown` and is meant to stay that way for someone who never saw a consent notice. Do not set `given` on their behalf.",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string().min(1),
              email: z.string().optional(),
              phone: z.string().optional(),
              headline: z.string().optional(),
              location: z.string().optional(),
              links: z.array(z.object({ label: z.string(), url: z.string() })).optional(),
              source: z.enum(["career_site", "referral", "sourced", "agency", "import", "other"]).optional(),
              source_detail: z.string().optional(),
              tags: z.array(z.string()).optional(),
              /** Create the application in one call — the usual case when sourcing for a role. */
              job_id: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: { 201: ok("The created candidate", CandidateSchema.extend({ application_id: z.string().nullable() })) },
  });

  app.openapi(createCandidate, async (c) => {
    const body = c.req.valid("json");
    const id = uid();
    await run(
      `INSERT INTO candidates (id, name, email, phone, headline, location, links_json, source, source_detail, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        body.name,
        body.email ?? "",
        body.phone ?? "",
        body.headline ?? "",
        body.location ?? "",
        JSON.stringify(body.links ?? []),
        body.source ?? "sourced",
        body.source_detail ?? "",
        actorId(c),
      ],
    );
    for (const tag of body.tags ?? []) {
      await run("INSERT OR IGNORE INTO candidate_tags (candidate_id, tag) VALUES (?, ?)", [id, tag]);
    }

    let applicationId: string | null = null;
    if (body.job_id) applicationId = await openApplication(c, body.job_id, id, body.source ?? "sourced");

    await log(c, { kind: "applied", candidateId: id, applicationId, jobId: body.job_id ?? null, summary: `Added ${body.name}` });

    const candidate = await get<Record<string, unknown>>("SELECT * FROM candidates WHERE id = ?", [id]);
    return c.json({ ...candidate, application_id: applicationId } as never, 201);
  });

  const getCandidate = createRoute({
    method: "get",
    path: "/api/candidates/{id}",
    tags: ["Candidates"],
    summary: "One candidate with their files, tags, pools and applications",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: ok(
        "The candidate",
        CandidateSchema.extend({
          attachments: z.array(AttachmentSchema),
          applications: z.array(z.record(z.unknown())),
          pools: z.array(z.object({ id: z.string(), name: z.string() })),
        }),
      ),
      404: fail("No such candidate"),
    },
  });

  app.openapi(getCandidate, async (c) => {
    const { id } = c.req.valid("param");
    const candidate = await get<Record<string, unknown>>("SELECT * FROM candidates WHERE id = ?", [id]);
    if (!candidate) return c.json({ error: "No such candidate" } as never, 404);

    const attachments = await query<Record<string, unknown>>(
      "SELECT id, candidate_id, application_id, kind, name, mime, size_bytes, page_count, locator_kind, extract_status, extract_error, created_at FROM attachments WHERE candidate_id = ? ORDER BY created_at",
      [id],
    );
    const applications = await query<Record<string, unknown>>(
      `SELECT a.*, j.title AS job_title, j.slug AS job_slug, s.name AS stage_name, s.kind AS stage_kind
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
         LEFT JOIN job_stages s ON s.id = a.stage_id
        WHERE a.candidate_id = ?
        ORDER BY a.applied_at DESC`,
      [id],
    );
    const tags = await query<{ tag: string }>("SELECT tag FROM candidate_tags WHERE candidate_id = ? ORDER BY tag", [id]);
    const pools = await query<{ id: string; name: string }>(
      "SELECT p.id, p.name FROM talent_pools p JOIN talent_pool_members m ON m.pool_id = p.id WHERE m.candidate_id = ? ORDER BY p.name",
      [id],
    );

    return c.json({ ...candidate, attachments, applications, tags: tags.map((t) => t.tag), pools } as never);
  });

  const updateCandidate = createRoute({
    method: "patch",
    path: "/api/candidates/{id}",
    tags: ["Candidates"],
    summary: "Edit a candidate's details, tags or consent",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string().min(1).optional(),
              email: z.string().optional(),
              phone: z.string().optional(),
              headline: z.string().optional(),
              location: z.string().optional(),
              links: z.array(z.object({ label: z.string(), url: z.string() })).optional(),
              source_detail: z.string().optional(),
              tags: z.array(z.string()).optional(),
              consent_status: z.enum(["given", "withdrawn", "unknown"]).optional(),
            }),
          },
        },
      },
    },
    responses: { 200: ok("The updated candidate", CandidateSchema), 404: fail("No such candidate") },
  });

  app.openapi(updateCandidate, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const before = await get<{ id: string; name: string; consent_status: string }>(
      "SELECT id, name, consent_status FROM candidates WHERE id = ?",
      [id],
    );
    if (!before) return c.json({ error: "No such candidate" } as never, 404);

    const sets: string[] = [];
    const params: unknown[] = [];
    for (const field of ["name", "email", "phone", "headline", "location", "source_detail"] as const) {
      if (body[field] !== undefined) {
        sets.push(`${field} = ?`);
        params.push(body[field]);
      }
    }
    if (body.links !== undefined) {
      sets.push("links_json = ?");
      params.push(JSON.stringify(body.links));
    }
    if (body.consent_status !== undefined) {
      sets.push("consent_status = ?", "consent_at = datetime('now')");
      params.push(body.consent_status);
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      await run(`UPDATE candidates SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
    }

    if (body.tags !== undefined) {
      await run("DELETE FROM candidate_tags WHERE candidate_id = ?", [id]);
      for (const tag of body.tags) {
        await run("INSERT OR IGNORE INTO candidate_tags (candidate_id, tag) VALUES (?, ?)", [id, tag]);
      }
    }

    if (body.consent_status && body.consent_status !== before.consent_status) {
      await log(c, {
        kind: "consent",
        candidateId: id,
        summary: `Consent recorded as ${body.consent_status}`,
        detail: { from: before.consent_status, to: body.consent_status },
      });
    }

    const candidate = await get<Record<string, unknown>>("SELECT * FROM candidates WHERE id = ?", [id]);
    return c.json(candidate as never);
  });

  const deleteCandidate = createRoute({
    method: "delete",
    path: "/api/candidates/{id}",
    tags: ["Candidates"],
    summary: "Erase a candidate and everything filed under them",
    description:
      "This is the erasure request path: files, extracted text, applications, notes, evaluations, messages and log rows all go. It is irreversible by design — a soft delete would not satisfy the request that prompted it.",
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: ok("Erased", z.object({ ok: z.boolean(), files_deleted: z.number().int() })), 404: fail("No such candidate") },
  });

  app.openapi(deleteCandidate, async (c) => {
    const { id } = c.req.valid("param");
    if (!(await get<{ id: string }>("SELECT id FROM candidates WHERE id = ?", [id]))) {
      return c.json({ error: "No such candidate" } as never, 404);
    }
    // Files first: the cascade drops the rows that name them, and an object
    // nobody can find is an object nobody can delete either.
    const files = await query<{ r2_key: string }>("SELECT r2_key FROM attachments WHERE candidate_id = ?", [id]);
    await Promise.all(files.map((f) => c.env.UPLOADS.delete(f.r2_key)));
    await run("DELETE FROM candidates WHERE id = ?", [id]);
    return c.json({ ok: true, files_deleted: files.length } as never);
  });

  // ── Files ───────────────────────────────────────────────────────────

  const uploadAttachment = createRoute({
    method: "post",
    path: "/api/candidates/{id}/attachments",
    tags: ["Candidates"],
    summary: "Attach a CV or other document",
    description:
      "Multipart: `file`, optional `kind` (cv | cover_letter | portfolio | other) and `application_id`. Stores the file and returns immediately as `pending`; call the extract endpoint to read its text.",
    request: { params: z.object({ id: z.string() }) },
    responses: { 201: ok("The stored file", AttachmentSchema), 404: fail("No such candidate"), 422: fail("Unreadable file type") },
  });

  app.openapi(uploadAttachment, async (c) => {
    const { id } = c.req.valid("param");
    if (!(await get<{ id: string }>("SELECT id FROM candidates WHERE id = ?", [id]))) {
      return c.json({ error: "No such candidate" } as never, 404);
    }
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "No file was sent" } as never, 422);

    const kind = String(form.get("kind") ?? "cv");
    const applicationId = form.get("application_id") ? String(form.get("application_id")) : null;
    const mime = file.type || "";
    if (!isSupported(file.name, mime)) {
      return c.json(
        {
          error: `${file.name}: only PDF, DOCX and plain text can be read. A scanned image has no text layer — ask for a PDF with real text.`,
        } as never,
        422,
      );
    }

    const attachmentId = uid();
    const r2Key = `candidates/${id}/${attachmentId}`;
    await c.env.UPLOADS.put(r2Key, await file.arrayBuffer(), {
      httpMetadata: { contentType: mime || "application/octet-stream" },
    });
    await run(
      "INSERT INTO attachments (id, candidate_id, application_id, kind, name, r2_key, mime, size_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [attachmentId, id, applicationId, kind, file.name, r2Key, mime, file.size],
    );

    const row = await get<Record<string, unknown>>("SELECT * FROM attachments WHERE id = ?", [attachmentId]);
    return c.json(row as never, 201);
  });

  const extractAttachment = createRoute({
    method: "post",
    path: "/api/attachments/{id}/extract",
    tags: ["Candidates"],
    summary: "Read a stored file's text",
    description:
      "Idempotent — safe to call again on a file stuck at `pending`, which is what an upload whose tab closed mid-way leaves behind.",
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: ok("The file, now readable or failed", AttachmentSchema), 404: fail("No such file") },
  });

  app.openapi(extractAttachment, async (c) => {
    const { id } = c.req.valid("param");
    const row = await get<{ id: string; name: string; mime: string; r2_key: string }>(
      "SELECT id, name, mime, r2_key FROM attachments WHERE id = ?",
      [id],
    );
    if (!row) return c.json({ error: "No such file" } as never, 404);

    const object = await c.env.UPLOADS.get(row.r2_key);
    if (!object) {
      await run("UPDATE attachments SET extract_status = 'failed', extract_error = ? WHERE id = ?", [
        "the stored file is missing",
        id,
      ]);
      return c.json({ error: "The stored file is missing" } as never, 404);
    }

    // Re-extraction replaces rather than appends, so calling this twice gives
    // one copy of the text and not two.
    await run("DELETE FROM attachment_pages WHERE attachment_id = ?", [id]);
    try {
      const bytes = await object.arrayBuffer();
      const { pages, locatorKind } = await extract(bytes, row.name, row.mime);
      for (const p of pages) {
        await run("INSERT INTO attachment_pages (attachment_id, page_no, text) VALUES (?, ?, ?)", [id, p.page_no, p.text]);
      }
      await run(
        "UPDATE attachments SET extract_status = 'ready', extract_error = '', page_count = ?, locator_kind = ? WHERE id = ?",
        [pages.length, locatorKind, id],
      );
    } catch (err) {
      const message = err instanceof UnsupportedFileError ? err.message : (err as Error).message;
      await run("UPDATE attachments SET extract_status = 'failed', extract_error = ? WHERE id = ?", [message, id]);
    }

    const after = await get<Record<string, unknown>>("SELECT * FROM attachments WHERE id = ?", [id]);
    return c.json(after as never);
  });

  const candidateText = createRoute({
    method: "get",
    path: "/api/candidates/{id}/text",
    tags: ["Screening"],
    summary: "The extracted text of a candidate's documents",
    description:
      "How to read a candidate. Every page carries the `attachment_id` and `page_no` an evidence quote is checked against, so cite the numbers this call returns.",
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({
        from: z.string().optional().openapi({ description: "Page index to resume from (default 0)" }),
        limit: z.string().optional().openapi({ description: `Pages per call (default and max ${TEXT_PAGE_LIMIT})` }),
      }),
    },
    responses: {
      200: ok(
        "The text",
        z.object({
          candidate: z.object({ id: z.string(), name: z.string() }),
          pages: z.array(
            z.object({
              attachment_id: z.string(),
              attachment_name: z.string(),
              kind: z.string(),
              locator_kind: z.string(),
              page_no: z.number().int(),
              text: z.string(),
            }),
          ),
          total: z.number().int(),
          next: z.number().int().nullable(),
        }),
      ),
      404: fail("No such candidate"),
    },
  });

  app.openapi(candidateText, async (c) => {
    const { id } = c.req.valid("param");
    const q = c.req.valid("query");
    const candidate = await get<{ id: string; name: string }>("SELECT id, name FROM candidates WHERE id = ?", [id]);
    if (!candidate) return c.json({ error: "No such candidate" } as never, 404);

    const from = Math.max(0, Number(q.from) || 0);
    const limit = Math.min(TEXT_PAGE_LIMIT, Math.max(1, Number(q.limit) || TEXT_PAGE_LIMIT));

    const pages = await query<Record<string, unknown>>(
      `SELECT p.attachment_id, a.name AS attachment_name, a.kind, a.locator_kind, p.page_no, p.text
         FROM attachment_pages p
         JOIN attachments a ON a.id = p.attachment_id
        WHERE a.candidate_id = ?
        ORDER BY a.created_at, p.page_no
        LIMIT ? OFFSET ?`,
      [id, limit, from],
    );
    const total = await get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM attachment_pages p JOIN attachments a ON a.id = p.attachment_id WHERE a.candidate_id = ?",
      [id],
    );
    const count = total?.n ?? 0;
    return c.json({ candidate, pages, total: count, next: from + limit < count ? from + limit : null } as never);
  });

  const deleteAttachment = createRoute({
    method: "delete",
    path: "/api/attachments/{id}",
    tags: ["Candidates"],
    summary: "Delete a stored file and its text",
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: ok("Deleted", z.object({ ok: z.boolean() })), 404: fail("No such file") },
  });

  app.openapi(deleteAttachment, async (c) => {
    const { id } = c.req.valid("param");
    const row = await get<{ r2_key: string }>("SELECT r2_key FROM attachments WHERE id = ?", [id]);
    if (!row) return c.json({ error: "No such file" } as never, 404);
    await c.env.UPLOADS.delete(row.r2_key);
    await run("DELETE FROM attachments WHERE id = ?", [id]);
    return c.json({ ok: true } as never);
  });

  // The raw file, for a human. Deliberately not in the agent's reading path —
  // the extracted text is, because that is what evidence is checked against.
  app.get("/api/attachments/:id/file", async (c) => {
    const row = await get<{ r2_key: string; mime: string; name: string }>(
      "SELECT r2_key, mime, name FROM attachments WHERE id = ?",
      [c.req.param("id")],
    );
    if (!row) return c.json({ error: "No such file" }, 404);
    const object = await c.env.UPLOADS.get(row.r2_key);
    if (!object) return c.json({ error: "The stored file is missing" }, 404);
    return new Response(object.body, {
      headers: {
        "Content-Type": row.mime || "application/octet-stream",
        // inline: a CV is meant to be read in the tab beside the pipeline, not
        // downloaded to a laptop where it outlives the retention policy.
        "Content-Disposition": `inline; filename="${row.name.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  });

  // ── Talent pools ────────────────────────────────────────────────────

  const listPools = createRoute({
    method: "get",
    path: "/api/talent-pools",
    tags: ["Candidates"],
    summary: "Talent pools with their sizes",
    responses: {
      200: ok(
        "The pools",
        z.object({
          pools: z.array(
            z.object({ id: z.string(), name: z.string(), description: z.string(), member_count: z.number().int(), created_at: z.string() }),
          ),
        }),
      ),
    },
  });

  // A team keeps a handful of pools — the small fixed reference set exception.
  app.openapi(listPools, async (c) => {
    const pools = await query<Record<string, unknown>>(
      `SELECT p.*, (SELECT COUNT(*) FROM talent_pool_members m WHERE m.pool_id = p.id) AS member_count
         FROM talent_pools p ORDER BY p.name LIMIT 100`,
    );
    return c.json({ pools } as never);
  });

  const createPool = createRoute({
    method: "post",
    path: "/api/talent-pools",
    tags: ["Candidates"],
    summary: "Create a talent pool",
    request: {
      body: { content: { "application/json": { schema: z.object({ name: z.string().min(1), description: z.string().optional() }) } } },
    },
    responses: { 201: ok("The created pool", z.object({ id: z.string() })) },
  });

  app.openapi(createPool, async (c) => {
    const body = c.req.valid("json");
    const id = uid();
    await run("INSERT INTO talent_pools (id, name, description) VALUES (?, ?, ?)", [id, body.name, body.description ?? ""]);
    return c.json({ id } as never, 201);
  });

  const setPoolMembership = createRoute({
    method: "post",
    path: "/api/talent-pools/{id}/members",
    tags: ["Candidates"],
    summary: "Add or remove a candidate from a pool",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": { schema: z.object({ candidate_id: z.string(), member: z.boolean().default(true) }) },
        },
      },
    },
    responses: { 200: ok("Updated", z.object({ ok: z.boolean() })), 404: fail("No such pool or candidate") },
  });

  app.openapi(setPoolMembership, async (c) => {
    const { id } = c.req.valid("param");
    const { candidate_id, member } = c.req.valid("json");
    const pool = await get<{ id: string; name: string }>("SELECT id, name FROM talent_pools WHERE id = ?", [id]);
    if (!pool) return c.json({ error: "No such pool" } as never, 404);

    if (member) {
      await run("INSERT OR IGNORE INTO talent_pool_members (pool_id, candidate_id, added_by) VALUES (?, ?, ?)", [
        id,
        candidate_id,
        actorName(c),
      ]);
    } else {
      await run("DELETE FROM talent_pool_members WHERE pool_id = ? AND candidate_id = ?", [id, candidate_id]);
    }
    await log(c, {
      kind: "pool",
      candidateId: candidate_id,
      summary: member ? `Added to the “${pool.name}” pool` : `Removed from the “${pool.name}” pool`,
    });
    return c.json({ ok: true } as never);
  });

  const deletePool = createRoute({
    method: "delete",
    path: "/api/talent-pools/{id}",
    tags: ["Candidates"],
    summary: "Delete a talent pool",
    description: "The candidates in it are untouched — only the grouping goes.",
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: ok("Deleted", z.object({ ok: z.boolean() })) },
  });

  app.openapi(deletePool, async (c) => {
    await run("DELETE FROM talent_pools WHERE id = ?", [c.req.valid("param").id]);
    return c.json({ ok: true } as never);
  });
}

/**
 * Put a candidate into a job's pipeline at its first stage.
 *
 * Shared by the sourcing path above and the public apply route, because "which
 * stage does a new application start in" must have exactly one answer.
 */
export async function openApplication(
  c: { env: unknown },
  jobId: string,
  candidateId: string,
  source: string,
): Promise<string | null> {
  const job = await get<{ id: string }>("SELECT id FROM jobs WHERE id = ?", [jobId]);
  if (!job) return null;

  const existing = await get<{ id: string }>("SELECT id FROM applications WHERE job_id = ? AND candidate_id = ?", [
    jobId,
    candidateId,
  ]);
  if (existing) return existing.id;

  const stage = await get<{ id: string }>(
    "SELECT id FROM job_stages WHERE job_id = ? ORDER BY position LIMIT 1",
    [jobId],
  );
  const id = uid();
  await run("INSERT INTO applications (id, job_id, candidate_id, stage_id, source) VALUES (?, ?, ?, ?, ?)", [
    id,
    jobId,
    candidateId,
    stage?.id ?? null,
    source,
  ]);
  return id;
}
