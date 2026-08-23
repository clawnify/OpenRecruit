// Settings: the careers site's identity, the custom fields on a candidate, the
// per-stage automations, and the retention clock.

import { createRoute, z } from "@clawnify/app";
import { get, query, run } from "../db.js";
import { fail, ok, uid, type App } from "../env.js";
import { log } from "../activity.js";

const SettingsSchema = z
  .object({
    company_name: z.string(),
    company_url: z.string(),
    careers_url: z.string(),
    tagline: z.string(),
    intro_md: z.string(),
    logo_key: z.string(),
    hero_key: z.string(),
    accent: z.string(),
    privacy_url: z.string(),
    consent_text: z.string(),
    retention_days: z.number().int(),
    blind_until_position: z.number().int(),
    hide_evaluations: z.number().int(),
    updated_at: z.string(),
  })
  .openapi("Settings");

const FieldSchema = z
  .object({ id: z.string(), position: z.number().int(), label: z.string(), type: z.string(), options: z.string() })
  .openapi("ProfileField");

export function registerSettings(app: App) {
  const getSettings = createRoute({
    method: "get",
    path: "/api/settings",
    tags: ["Settings"],
    summary: "The careers site's identity and the hiring policies",
    responses: { 200: ok("The settings", SettingsSchema.extend({ can_send_email: z.boolean() })) },
  });

  app.openapi(getSettings, async (c) => {
    const settings = await get<Record<string, unknown>>("SELECT * FROM settings WHERE id = 1");
    return c.json({
      ...settings,
      can_send_email: Boolean(c.env.RESEND_API_KEY && c.env.HIRING_FROM_EMAIL),
    } as never);
  });

  const updateSettings = createRoute({
    method: "patch",
    path: "/api/settings",
    tags: ["Settings"],
    summary: "Edit the careers site and hiring policies",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              company_name: z.string().optional(),
              company_url: z.string().optional(),
              careers_url: z
                .string()
                .optional()
                .openapi({ description: "Absolute origin the public careers site is served from. Needed for structured data and the job feed." }),
              tagline: z.string().optional(),
              intro_md: z.string().optional(),
              accent: z.string().optional(),
              privacy_url: z.string().optional(),
              consent_text: z.string().optional(),
              retention_days: z.number().int().min(0).max(3650).optional(),
              blind_until_position: z.number().int().min(0).optional(),
              hide_evaluations: z.boolean().optional(),
            }),
          },
        },
      },
    },
    responses: { 200: ok("The settings", SettingsSchema) },
  });

  app.openapi(updateSettings, async (c) => {
    const body = c.req.valid("json");
    const sets: string[] = [];
    const params: unknown[] = [];
    const scalar = [
      "company_name",
      "company_url",
      "careers_url",
      "tagline",
      "intro_md",
      "accent",
      "privacy_url",
      "consent_text",
      "retention_days",
      "blind_until_position",
    ] as const;
    for (const field of scalar) {
      if (body[field] !== undefined) {
        sets.push(`${field} = ?`);
        params.push(body[field]);
      }
    }
    if (body.hide_evaluations !== undefined) {
      sets.push("hide_evaluations = ?");
      params.push(body.hide_evaluations ? 1 : 0);
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      await run(`UPDATE settings SET ${sets.join(", ")} WHERE id = 1`, params);
    }
    const settings = await get<Record<string, unknown>>("SELECT * FROM settings WHERE id = 1");
    return c.json(settings as never);
  });

  const uploadImage = createRoute({
    method: "post",
    path: "/api/settings/images/{kind}",
    tags: ["Settings"],
    summary: "Upload the careers site's logo or hero image",
    request: { params: z.object({ kind: z.enum(["logo", "hero"]) }) },
    responses: { 200: ok("Stored", z.object({ key: z.string() })), 422: fail("Not an image") },
  });

  app.openapi(uploadImage, async (c) => {
    const { kind } = c.req.valid("param");
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.type.startsWith("image/")) {
      return c.json({ error: "Send an image file." } as never, 422);
    }
    const key = `branding/${kind}-${uid()}`;
    await c.env.UPLOADS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

    // Replace rather than accumulate: nothing else references the old object, so
    // keeping it is a bucket that grows every time someone tries a new logo.
    const previous = await get<Record<string, string>>("SELECT logo_key, hero_key FROM settings WHERE id = 1");
    const old = kind === "logo" ? previous?.logo_key : previous?.hero_key;
    await run(`UPDATE settings SET ${kind}_key = ?, updated_at = datetime('now') WHERE id = 1`, [key]);
    if (old) await c.env.UPLOADS.delete(old);

    return c.json({ key } as never);
  });

  // ── Custom profile fields ───────────────────────────────────────────

  const listFields = createRoute({
    method: "get",
    path: "/api/profile-fields",
    tags: ["Settings"],
    summary: "The custom fields kept on every candidate",
    responses: { 200: ok("The fields", z.object({ fields: z.array(FieldSchema) })) },
  });

  // A team defines a handful. The small fixed reference set exception.
  app.openapi(listFields, async (c) => {
    const fields = await query<Record<string, unknown>>("SELECT * FROM profile_fields ORDER BY position LIMIT 100");
    return c.json({ fields } as never);
  });

  const putFields = createRoute({
    method: "put",
    path: "/api/profile-fields",
    tags: ["Settings"],
    summary: "Replace the custom candidate fields",
    description:
      "There is deliberately no field type for a protected characteristic. Diversity monitoring is a separate, anonymised exercise; a gender box next to “notice period” on a candidate's profile is data that will end up informing a decision it must not inform.",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              fields: z.array(
                z.object({
                  id: z.string().optional(),
                  label: z.string().min(1),
                  type: z.enum(["text", "textarea", "boolean", "single_choice", "multi_choice", "number", "date", "salary", "address", "languages", "skills", "url"]),
                  options: z.string().optional(),
                }),
              ),
            }),
          },
        },
      },
    },
    responses: { 200: ok("The fields", z.object({ fields: z.array(FieldSchema) })) },
  });

  app.openapi(putFields, async (c) => {
    const { fields } = c.req.valid("json");
    // Keeping ids that were sent back is what makes an edit an edit: dropping
    // and recreating would cascade every candidate's answers away, so renaming
    // a field would quietly erase the data in it.
    const keep = new Set(fields.map((f) => f.id).filter(Boolean) as string[]);
    const existing = await query<{ id: string }>("SELECT id FROM profile_fields");
    for (const row of existing) {
      if (!keep.has(row.id)) await run("DELETE FROM profile_fields WHERE id = ?", [row.id]);
    }
    for (const [i, f] of fields.entries()) {
      if (f.id && keep.has(f.id)) {
        await run("UPDATE profile_fields SET position = ?, label = ?, type = ?, options = ? WHERE id = ?", [
          i,
          f.label,
          f.type,
          f.options ?? "",
          f.id,
        ]);
      } else {
        await run("INSERT INTO profile_fields (id, position, label, type, options) VALUES (?, ?, ?, ?, ?)", [
          uid(),
          i,
          f.label,
          f.type,
          f.options ?? "",
        ]);
      }
    }
    const saved = await query<Record<string, unknown>>("SELECT * FROM profile_fields ORDER BY position");
    return c.json({ fields: saved } as never);
  });

  const putFieldValues = createRoute({
    method: "put",
    path: "/api/candidates/{id}/fields",
    tags: ["Candidates"],
    summary: "Set a candidate's custom field values",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": { schema: z.object({ values: z.array(z.object({ field_id: z.string(), value: z.string() })) }) },
        },
      },
    },
    responses: { 200: ok("Saved", z.object({ ok: z.boolean() })), 404: fail("No such candidate") },
  });

  app.openapi(putFieldValues, async (c) => {
    const { id } = c.req.valid("param");
    const { values } = c.req.valid("json");
    if (!(await get<{ id: string }>("SELECT id FROM candidates WHERE id = ?", [id]))) {
      return c.json({ error: "No such candidate" } as never, 404);
    }
    for (const v of values) {
      await run(
        "INSERT INTO candidate_field_values (candidate_id, field_id, value) VALUES (?, ?, ?) ON CONFLICT (candidate_id, field_id) DO UPDATE SET value = excluded.value",
        [id, v.field_id, v.value],
      );
    }
    return c.json({ ok: true } as never);
  });

  const getFieldValues = createRoute({
    method: "get",
    path: "/api/candidates/{id}/fields",
    tags: ["Candidates"],
    summary: "A candidate's custom field values",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: ok(
        "The values",
        z.object({
          values: z.array(z.object({ field_id: z.string(), label: z.string(), type: z.string(), options: z.string(), value: z.string() })),
        }),
      ),
    },
  });

  app.openapi(getFieldValues, async (c) => {
    const { id } = c.req.valid("param");
    const values = await query<Record<string, unknown>>(
      `SELECT f.id AS field_id, f.label, f.type, f.options, COALESCE(v.value, '') AS value
         FROM profile_fields f
         LEFT JOIN candidate_field_values v ON v.field_id = f.id AND v.candidate_id = ?
        ORDER BY f.position`,
      [id],
    );
    return c.json({ values } as never);
  });

  // ── Stage automations ───────────────────────────────────────────────

  const listStageActions = createRoute({
    method: "get",
    path: "/api/stages/{id}/actions",
    tags: ["Settings"],
    summary: "What happens automatically when someone reaches this stage",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: ok("The actions", z.object({ actions: z.array(z.object({ id: z.string(), kind: z.string(), config: z.string(), position: z.number().int() })) })),
    },
  });

  app.openapi(listStageActions, async (c) => {
    const actions = await query<Record<string, unknown>>(
      "SELECT id, kind, config, position FROM stage_actions WHERE stage_id = ? ORDER BY position LIMIT 50",
      [c.req.valid("param").id],
    );
    return c.json({ actions } as never);
  });

  const putStageActions = createRoute({
    method: "put",
    path: "/api/stages/{id}/actions",
    tags: ["Settings"],
    summary: "Set what happens when someone reaches this stage",
    description:
      "`message` prepares the mail as a task rather than sending it. An unattended email to a candidate is the one automation that cannot be taken back, so a person presses send.",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              actions: z.array(
                z.object({
                  kind: z.enum(["task", "tag", "message"]),
                  config: z.record(z.unknown()).openapi({ description: "{title, due_days} | {tag} | {template_id}" }),
                }),
              ),
            }),
          },
        },
      },
    },
    responses: { 200: ok("Saved", z.object({ ok: z.boolean() })), 404: fail("No such stage") },
  });

  app.openapi(putStageActions, async (c) => {
    const { id } = c.req.valid("param");
    const { actions } = c.req.valid("json");
    if (!(await get<{ id: string }>("SELECT id FROM job_stages WHERE id = ?", [id]))) {
      return c.json({ error: "No such stage" } as never, 404);
    }
    await run("DELETE FROM stage_actions WHERE stage_id = ?", [id]);
    for (const [i, a] of actions.entries()) {
      await run("INSERT INTO stage_actions (id, stage_id, kind, config, position) VALUES (?, ?, ?, ?, ?)", [
        uid(),
        id,
        a.kind,
        JSON.stringify(a.config),
        i,
      ]);
    }
    return c.json({ ok: true } as never);
  });

  // ── Retention ───────────────────────────────────────────────────────

  const retentionDue = createRoute({
    method: "get",
    path: "/api/retention",
    tags: ["Settings"],
    summary: "Candidates whose retention period has run out",
    description:
      "The clock starts when a person's last application closes and runs for the configured period. This lists who is due; erasing them is a separate, deliberate call.",
    responses: {
      200: ok(
        "Who is due",
        z.object({
          retention_days: z.number().int(),
          due: z.array(z.object({ id: z.string(), name: z.string(), email: z.string(), retain_until: z.string() })),
          due_count: z.number().int(),
          upcoming_count: z.number().int(),
        }),
      ),
    },
  });

  app.openapi(retentionDue, async (c) => {
    const settings = await get<{ retention_days: number }>("SELECT retention_days FROM settings WHERE id = 1");
    const due = await query<{ id: string; name: string; email: string; retain_until: string }>(
      "SELECT id, name, email, retain_until FROM candidates WHERE retain_until IS NOT NULL AND retain_until <= date('now') ORDER BY retain_until LIMIT 100",
    );
    const dueCount = await get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM candidates WHERE retain_until IS NOT NULL AND retain_until <= date('now')",
    );
    const upcoming = await get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM candidates WHERE retain_until IS NOT NULL AND retain_until > date('now') AND retain_until <= date('now', '+30 days')",
    );
    return c.json({
      retention_days: settings?.retention_days ?? 180,
      due,
      due_count: dueCount?.n ?? 0,
      upcoming_count: upcoming?.n ?? 0,
    } as never);
  });

  const purge = createRoute({
    method: "post",
    path: "/api/retention/purge",
    tags: ["Settings"],
    summary: "Erase the candidates whose retention period has run out",
    description:
      "Irreversible, and deliberately a button rather than a schedule: this deletes people's data, and a job that quietly does it at 3am is one nobody can answer for. Returns what it erased.",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              confirm: z.literal(true).openapi({ description: "Must be true — a mis-typed call must not erase anybody." }),
              limit: z.number().int().min(1).max(500).optional(),
            }),
          },
        },
      },
    },
    responses: { 200: ok("What was erased", z.object({ erased: z.number().int(), files_deleted: z.number().int(), names: z.array(z.string()) })) },
  });

  app.openapi(purge, async (c) => {
    const { limit } = c.req.valid("json");
    const due = await query<{ id: string; name: string }>(
      "SELECT id, name FROM candidates WHERE retain_until IS NOT NULL AND retain_until <= date('now') ORDER BY retain_until LIMIT ?",
      [limit ?? 100],
    );

    let filesDeleted = 0;
    for (const candidate of due) {
      const files = await query<{ r2_key: string }>("SELECT r2_key FROM attachments WHERE candidate_id = ?", [candidate.id]);
      await Promise.all(files.map((f) => c.env.UPLOADS.delete(f.r2_key)));
      filesDeleted += files.length;
      await run("DELETE FROM candidates WHERE id = ?", [candidate.id]);
    }

    if (due.length) {
      // Logged with no candidate_id — the row it would point at is gone, which
      // is the point. What survives is that a purge happened, when, how many,
      // and who ran it; the names are not repeated into the record we just
      // erased them from.
      await log(c, {
        kind: "purge",
        summary: `Erased ${due.length} candidate record(s) past their retention period`,
        detail: { count: due.length, files: filesDeleted },
      });
    }

    return c.json({ erased: due.length, files_deleted: filesDeleted, names: due.map((d) => d.name) } as never);
  });
}
