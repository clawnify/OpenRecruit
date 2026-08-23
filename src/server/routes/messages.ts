// Talking to candidates.
//
// The app can send mail if the deployment brings a provider key, and records it
// either way. With no key configured, a message is composed, stored as `logged`,
// and handed back for the user to send from their own mailbox — which is honest
// about what happened and keeps the candidate's history complete. What it never
// does is fail silently, and it never sends anything a person did not press send
// on: a rejection that goes out because a rule fired is the one mistake in this
// app you cannot take back.

import { createRoute, z } from "@clawnify/app";
import { get, query, run } from "../db.js";
import { fail, ok, PaginationQuery, paginate, uid, type App } from "../env.js";
import { actorName, log } from "../activity.js";

const MessageSchema = z
  .object({
    id: z.string(),
    application_id: z.string(),
    direction: z.string(),
    to_email: z.string(),
    subject: z.string(),
    body: z.string(),
    status: z.string(),
    error: z.string(),
    sent_by: z.string(),
    created_at: z.string(),
  })
  .openapi("Message");

const TemplateSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    subject: z.string(),
    body: z.string(),
    stage_kind: z.string(),
    created_at: z.string(),
  })
  .openapi("MessageTemplate");

/**
 * Fill the placeholders a template may use.
 *
 * Deliberately a fixed, tiny set rather than a template language: the values
 * come from the database and the output goes to a person outside the company,
 * so there is nothing to gain and a lot to lose from letting a template evaluate
 * anything. An unknown placeholder is left alone rather than blanked, so a typo
 * is visible in the draft instead of producing "Dear ,".
 */
export function fillTemplate(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key.toLowerCase()) ? values[key.toLowerCase()] : match,
  );
}

interface SendResult {
  status: "sent" | "logged" | "failed";
  providerId: string;
  error: string;
}

/**
 * Hand the message to the provider, if there is one.
 *
 * `logged` is not a failure — it is the state of a deployment with no mail
 * provider, where the app's job is to compose the message and record that it was
 * sent, not to pretend it delivered it.
 */
async function deliver(
  env: { RESEND_API_KEY?: string; HIRING_FROM_EMAIL?: string },
  message: { to: string; subject: string; body: string },
): Promise<SendResult> {
  if (!env.RESEND_API_KEY || !env.HIRING_FROM_EMAIL) {
    return { status: "logged", providerId: "", error: "" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.HIRING_FROM_EMAIL,
        to: [message.to],
        subject: message.subject,
        // Plain text: a rejection or an interview invitation is correspondence,
        // not marketing, and HTML mail from a hiring team reads as a mailshot.
        text: message.body,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const detail = typeof payload.message === "string" ? payload.message : `provider returned ${res.status}`;
      return { status: "failed", providerId: "", error: detail };
    }
    return { status: "sent", providerId: String(payload.id ?? ""), error: "" };
  } catch (err) {
    return { status: "failed", providerId: "", error: (err as Error).message };
  }
}

export function registerMessages(app: App) {
  const listMessages = createRoute({
    method: "get",
    path: "/api/applications/{id}/messages",
    tags: ["Messages"],
    summary: "Correspondence with one candidate",
    request: { params: z.object({ id: z.string() }), query: PaginationQuery },
    responses: {
      200: ok("A page of messages", z.object({ messages: z.array(MessageSchema), total: z.number().int(), page: z.number().int() })),
    },
  });

  app.openapi(listMessages, async (c) => {
    const { id } = c.req.valid("param");
    const { limit, offset, page } = paginate(c.req.valid("query"));
    const messages = await query<Record<string, unknown>>(
      "SELECT * FROM messages WHERE application_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [id, limit, offset],
    );
    const total = await get<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE application_id = ?", [id]);
    return c.json({ messages, total: total?.n ?? 0, page } as never);
  });

  const compose = createRoute({
    method: "post",
    path: "/api/applications/{id}/messages/compose",
    tags: ["Messages"],
    summary: "Fill a template for one candidate without sending anything",
    description: "What the composer opens with. Nothing is stored and nothing leaves the building.",
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { "application/json": { schema: z.object({ template_id: z.string() }) } } },
    },
    responses: {
      200: ok("The filled draft", z.object({ subject: z.string(), body: z.string(), to_email: z.string(), can_send: z.boolean() })),
      404: fail("No such application or template"),
    },
  });

  app.openapi(compose, async (c) => {
    const { id } = c.req.valid("param");
    const { template_id } = c.req.valid("json");
    const context = await messageContext(id);
    if (!context) return c.json({ error: "No such application" } as never, 404);
    const template = await get<{ subject: string; body: string }>("SELECT subject, body FROM message_templates WHERE id = ?", [
      template_id,
    ]);
    if (!template) return c.json({ error: "No such template" } as never, 404);

    return c.json({
      subject: fillTemplate(template.subject, context.values),
      body: fillTemplate(template.body, context.values),
      to_email: context.email,
      can_send: Boolean(c.env.RESEND_API_KEY && c.env.HIRING_FROM_EMAIL),
    } as never);
  });

  const send = createRoute({
    method: "post",
    path: "/api/applications/{id}/messages",
    tags: ["Messages"],
    summary: "Send a message to a candidate, or record one you sent yourself",
    description:
      "With a mail provider configured the message is sent and stored as `sent`. Without one it is stored as `logged` and returned for you to send from your own mailbox — the candidate's history stays complete either way.",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              subject: z.string().min(1),
              body: z.string().min(1),
              to_email: z.string().optional(),
              /** Record correspondence that happened elsewhere without trying to send it. */
              log_only: z.boolean().optional(),
            }),
          },
        },
      },
    },
    responses: {
      201: ok("The message", MessageSchema),
      404: fail("No such application"),
      422: fail("The candidate has no email address"),
    },
  });

  app.openapi(send, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const context = await messageContext(id);
    if (!context) return c.json({ error: "No such application" } as never, 404);

    const to = body.to_email || context.email;
    if (!to) {
      return c.json({ error: "This candidate has no email address on file." } as never, 422);
    }

    const result = body.log_only
      ? ({ status: "logged", providerId: "", error: "" } as SendResult)
      : await deliver(c.env, { to, subject: body.subject, body: body.body });

    const messageId = uid();
    await run(
      "INSERT INTO messages (id, application_id, direction, to_email, subject, body, status, error, provider_id, sent_by) VALUES (?, ?, 'out', ?, ?, ?, ?, ?, ?, ?)",
      [messageId, id, to, body.subject, body.body, result.status, result.error, result.providerId, actorName(c)],
    );
    await log(c, {
      kind: "message",
      applicationId: id,
      candidateId: context.candidateId,
      jobId: context.jobId,
      summary:
        result.status === "sent"
          ? `Emailed ${to}: ${body.subject}`
          : result.status === "failed"
            ? `Email to ${to} failed: ${result.error}`
            : `Recorded a message to ${to}: ${body.subject}`,
      detail: { status: result.status },
    });

    const message = await get<Record<string, unknown>>("SELECT * FROM messages WHERE id = ?", [messageId]);
    return c.json(message as never, 201);
  });

  // ── Templates ───────────────────────────────────────────────────────

  const listTemplates = createRoute({
    method: "get",
    path: "/api/message-templates",
    tags: ["Messages"],
    summary: "Saved message templates",
    description:
      "Placeholders: {{candidate_name}}, {{first_name}}, {{job_title}}, {{company_name}}, {{stage_name}}, {{sender_name}}.",
    responses: { 200: ok("The templates", z.object({ templates: z.array(TemplateSchema) })) },
  });

  // A handful per team. The small fixed reference set exception.
  app.openapi(listTemplates, async (c) => {
    const templates = await query<Record<string, unknown>>("SELECT * FROM message_templates ORDER BY name LIMIT 100");
    return c.json({ templates } as never);
  });

  const saveTemplate = createRoute({
    method: "post",
    path: "/api/message-templates",
    tags: ["Messages"],
    summary: "Create a message template",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string().min(1),
              subject: z.string().optional(),
              body: z.string().optional(),
              stage_kind: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: { 201: ok("The template", TemplateSchema) },
  });

  app.openapi(saveTemplate, async (c) => {
    const body = c.req.valid("json");
    const id = uid();
    await run("INSERT INTO message_templates (id, name, subject, body, stage_kind) VALUES (?, ?, ?, ?, ?)", [
      id,
      body.name,
      body.subject ?? "",
      body.body ?? "",
      body.stage_kind ?? "",
    ]);
    const template = await get<Record<string, unknown>>("SELECT * FROM message_templates WHERE id = ?", [id]);
    return c.json(template as never, 201);
  });

  const updateTemplate = createRoute({
    method: "patch",
    path: "/api/message-templates/{id}",
    tags: ["Messages"],
    summary: "Edit a message template",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({ name: z.string().optional(), subject: z.string().optional(), body: z.string().optional(), stage_kind: z.string().optional() }),
          },
        },
      },
    },
    responses: { 200: ok("The template", TemplateSchema), 404: fail("No such template") },
  });

  app.openapi(updateTemplate, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    if (!(await get<{ id: string }>("SELECT id FROM message_templates WHERE id = ?", [id]))) {
      return c.json({ error: "No such template" } as never, 404);
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const field of ["name", "subject", "body", "stage_kind"] as const) {
      if (body[field] !== undefined) {
        sets.push(`${field} = ?`);
        params.push(body[field]);
      }
    }
    if (sets.length) await run(`UPDATE message_templates SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
    const template = await get<Record<string, unknown>>("SELECT * FROM message_templates WHERE id = ?", [id]);
    return c.json(template as never);
  });

  const deleteTemplate = createRoute({
    method: "delete",
    path: "/api/message-templates/{id}",
    tags: ["Messages"],
    summary: "Delete a message template",
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: ok("Deleted", z.object({ ok: z.boolean() })) },
  });

  app.openapi(deleteTemplate, async (c) => {
    await run("DELETE FROM message_templates WHERE id = ?", [c.req.valid("param").id]);
    return c.json({ ok: true } as never);
  });
}

/** Everything a template needs to know about one application. */
async function messageContext(
  applicationId: string,
): Promise<{ email: string; candidateId: string; jobId: string; values: Record<string, string> } | null> {
  const row = await get<{
    candidate_id: string;
    job_id: string;
    name: string;
    email: string;
    job_title: string;
    stage_name: string | null;
    company_name: string;
  }>(
    `SELECT a.candidate_id, a.job_id, c.name, c.email, j.title AS job_title, s.name AS stage_name,
            (SELECT company_name FROM settings WHERE id = 1) AS company_name
       FROM applications a
       JOIN candidates c ON c.id = a.candidate_id
       JOIN jobs j ON j.id = a.job_id
       LEFT JOIN job_stages s ON s.id = a.stage_id
      WHERE a.id = ?`,
    [applicationId],
  );
  if (!row) return null;

  return {
    email: row.email,
    candidateId: row.candidate_id,
    jobId: row.job_id,
    values: {
      candidate_name: row.name,
      first_name: row.name.split(/\s+/)[0] ?? row.name,
      job_title: row.job_title,
      company_name: row.company_name ?? "",
      stage_name: row.stage_name ?? "",
      sender_name: "",
    },
  };
}
