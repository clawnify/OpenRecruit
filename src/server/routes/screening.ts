// Screening: the requirements grid, and the check that keeps it honest.
//
// This is the AI feature both of the products this app was modelled on now ship
// — a match score on the candidate card, a "good match" tag in the list. The
// difference here is not that the score exists, it is what stands behind it: a
// verdict of "met" is only counted once the app has located the quote it rests
// on in the candidate's own document. The percentage on the card is therefore a
// count of verified facts, not a model's confidence in itself.

import { caller, createRoute, z } from "@clawnify/app";
import { get, query, run } from "../db.js";
import { fail, ok, uid, type App } from "../env.js";
import { actorName, log } from "../activity.js";
import { requiresEvidence, verifyEvidence, type PageText } from "../evidence.js";
import { candidateBrief, dispatchAvailable, dispatchTask, listAgentServers, screeningBrief } from "../agent.js";

const ResultSchema = z
  .object({
    id: z.string(),
    application_id: z.string(),
    criterion_id: z.string(),
    criterion_key: z.string(),
    criterion_label: z.string(),
    weight: z.string(),
    verdict: z.string(),
    value: z.string(),
    evidence_quote: z.string(),
    attachment_id: z.string().nullable(),
    attachment_name: z.string().nullable(),
    page_no: z.number().int().nullable(),
    status: z.string(),
    rejected_reason: z.string(),
    assessed_by: z.string(),
    assessor: z.string(),
    created_at: z.string(),
  })
  .openapi("ScreeningResult");

/** How many verdicts one call may carry. A job has criteria, not thousands. */
const MAX_RESULTS_PER_CALL = 100;

async function candidatePages(candidateId: string): Promise<PageText[]> {
  return query<PageText>(
    `SELECT p.attachment_id, p.page_no, p.text
       FROM attachment_pages p JOIN attachments a ON a.id = p.attachment_id
      WHERE a.candidate_id = ?
      ORDER BY a.created_at, p.page_no`,
    [candidateId],
  );
}

/**
 * The number on the card.
 *
 * Only must-haves count, and only verified ones. A candidate who meets every
 * nice-to-have and no must-have is not an 80% match, and a rejected verdict
 * contributes nothing — that is the entire point of rejecting it. A job with no
 * must-haves has no score rather than a meaningless 100%.
 */
export async function matchScore(applicationId: string): Promise<{ score: number | null; met: number; total: number }> {
  const total = await get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM screening_criteria k
       JOIN applications a ON a.job_id = k.job_id
      WHERE a.id = ? AND k.weight = 'must_have'`,
    [applicationId],
  );
  const met = await get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM screening_results r
       JOIN screening_criteria k ON k.id = r.criterion_id
      WHERE r.application_id = ? AND k.weight = 'must_have'
        AND r.verdict = 'met' AND r.status != 'rejected'`,
    [applicationId],
  );
  const t = total?.n ?? 0;
  const m = met?.n ?? 0;
  return { score: t > 0 ? Math.round((m / t) * 100) : null, met: m, total: t };
}

export function registerScreening(app: App) {
  const listResults = createRoute({
    method: "get",
    path: "/api/applications/{id}/screening",
    tags: ["Screening"],
    summary: "A candidate's screening grid",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: ok(
        "The verdicts",
        z.object({
          results: z.array(ResultSchema),
          score: z.number().int().nullable(),
          met: z.number().int(),
          total: z.number().int(),
        }),
      ),
      404: fail("No such application"),
    },
  });

  app.openapi(listResults, async (c) => {
    const { id } = c.req.valid("param");
    if (!(await get<{ id: string }>("SELECT id FROM applications WHERE id = ?", [id]))) {
      return c.json({ error: "No such application" } as never, 404);
    }
    const results = await query<Record<string, unknown>>(
      `SELECT r.*, k.key AS criterion_key, k.label AS criterion_label, k.weight, a.name AS attachment_name
         FROM screening_results r
         JOIN screening_criteria k ON k.id = r.criterion_id
         LEFT JOIN attachments a ON a.id = r.attachment_id
        WHERE r.application_id = ?
        ORDER BY k.position`,
      [id],
    );
    const score = await matchScore(id);
    return c.json({ results, ...score } as never);
  });

  const postResults = createRoute({
    method: "post",
    path: "/api/applications/{id}/screening",
    tags: ["Screening"],
    summary: "Submit screening verdicts, each checked against the candidate's own documents",
    description:
      "A `met` verdict must carry an `evidence` quote copied verbatim from the candidate's CV or cover letter. The app locates it before storing the verdict as verified; one it cannot find is stored as rejected, shown to the user as unverified, and never counted towards the match score. `not_met` and `unclear` need no evidence — an absence cannot be quoted.\n\nReturns 422 when any verdict failed, with a reason per failure. Verdicts that passed in the same call are still stored, so only the failures need re-sending.",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              results: z
                .array(
                  z.object({
                    criterion: z.string().openapi({ description: "The criterion's `key`" }),
                    verdict: z.enum(["met", "not_met", "unclear"]),
                    value: z.string().optional().openapi({ description: "The concrete finding, e.g. “6 years”" }),
                    evidence: z.string().optional().openapi({ description: "Verbatim quote from the candidate's documents. Required for `met`." }),
                    attachment_id: z.string().optional(),
                    page: z.number().int().optional(),
                  }),
                )
                .min(1)
                .max(MAX_RESULTS_PER_CALL),
            }),
          },
        },
      },
    },
    responses: {
      200: ok("All verdicts verified", z.object({ accepted: z.number().int(), rejected: z.array(z.record(z.unknown())), score: z.number().int().nullable() })),
      422: ok("Some verdicts failed verification", z.object({ accepted: z.number().int(), rejected: z.array(z.record(z.unknown())), score: z.number().int().nullable() })),
      404: fail("No such application"),
    },
  });

  app.openapi(postResults, async (c) => {
    const { id } = c.req.valid("param");
    const { results } = c.req.valid("json");

    const application = await get<{ id: string; job_id: string; candidate_id: string }>(
      "SELECT id, job_id, candidate_id FROM applications WHERE id = ?",
      [id],
    );
    if (!application) return c.json({ error: "No such application" } as never, 404);

    const criteria = await query<{ id: string; key: string; label: string }>(
      "SELECT id, key, label FROM screening_criteria WHERE job_id = ?",
      [application.job_id],
    );
    const byKey = new Map(criteria.map((k) => [k.key, k]));
    const pages = await candidatePages(application.candidate_id);

    // Who is claiming this, read from the platform-verified identity rather than
    // from anything the caller can set.
    //
    // It decides only *whose* judgement this is — never whether the evidence is
    // checked. Any quote that arrives is verified, whoever sent it, because the
    // alternative is a check that a caller can switch off by being the wrong
    // kind of caller. (Off-platform this reads `public`, so an earlier version
    // that trusted "not an agent" disabled verification for every local run and
    // stored fabricated quotes as accepted.)
    const who = caller(c);
    const isAgent = who === "agent" || who === "agent-browser";
    const assessedBy = isAgent ? "agent" : "user";

    let accepted = 0;
    const rejected: Record<string, unknown>[] = [];

    for (const item of results) {
      const criterion = byKey.get(item.criterion);
      if (!criterion) {
        rejected.push({
          criterion: item.criterion,
          reason: `no criterion with key “${item.criterion}” — the valid keys came from GET /api/jobs/${application.job_id}/criteria`,
        });
        continue;
      }

      let status = "verified";
      let rejectedReason = "";
      let attachmentId: string | null = item.attachment_id ?? null;
      let page: number | null = item.page ?? null;
      const evidence = (item.evidence ?? "").trim();

      if (!requiresEvidence(item.verdict)) {
        // Nothing to verify, so nothing may be claimed either: a quote attached
        // to "not_met" would be evidence for a verdict it does not support.
        attachmentId = null;
        page = null;
      } else if (evidence) {
        // A quote was offered. It is checked, whoever offered it — a claim
        // about a person's experience is either locatable in what they sent or
        // it is not, and that does not depend on who is typing.
        const verdict = verifyEvidence(evidence, { attachmentId: item.attachment_id, page: item.page }, pages);
        if (verdict.ok) {
          attachmentId = verdict.attachmentId;
          page = verdict.page;
        } else {
          status = "rejected";
          rejectedReason = verdict.reason;
          rejected.push({
            criterion: criterion.key,
            label: criterion.label,
            reason: verdict.reason,
            ...(verdict.foundIn ? { found_in: verdict.foundIn } : {}),
          });
        }
      } else if (isAgent) {
        // No quote, and the claimant is the machine. This is the case the whole
        // feature exists for.
        status = "rejected";
        rejectedReason =
          "a “met” verdict must carry an `evidence` quote copied verbatim from the candidate's own documents";
        rejected.push({ criterion: criterion.key, label: criterion.label, reason: rejectedReason });
      } else {
        // A person marking a requirement met from their own reading. There is
        // nothing to check, so it is recorded as theirs, with their name on it,
        // and shown as a human judgement rather than a verified one.
        status = "manual";
        attachmentId = null;
        page = null;
      }

      await run(
        `INSERT INTO screening_results (id, application_id, criterion_id, verdict, value, evidence_quote,
                                        attachment_id, page_no, status, rejected_reason, assessed_by, assessor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (application_id, criterion_id) DO UPDATE SET
           verdict = excluded.verdict, value = excluded.value, evidence_quote = excluded.evidence_quote,
           attachment_id = excluded.attachment_id, page_no = excluded.page_no, status = excluded.status,
           rejected_reason = excluded.rejected_reason, assessed_by = excluded.assessed_by,
           assessor = excluded.assessor, created_at = datetime('now')`,
        [
          uid(),
          id,
          criterion.id,
          item.verdict,
          item.value ?? "",
          requiresEvidence(item.verdict) ? evidence : "",
          attachmentId,
          page,
          status,
          rejectedReason,
          assessedBy,
          isAgent ? "" : actorName(c),
        ],
      );
      if (status !== "rejected") accepted++;
    }

    const score = await matchScore(id);
    await log(c, {
      kind: "screening",
      applicationId: id,
      candidateId: application.candidate_id,
      jobId: application.job_id,
      summary: `Screened against ${results.length} requirement(s) — ${accepted} verified, ${rejected.length} unverified`,
      detail: { accepted, rejected: rejected.length, score: score.score },
    });

    return c.json({ accepted, rejected, score: score.score } as never, rejected.length ? 422 : 200);
  });

  // ── Handing screening to the agent ──────────────────────────────────

  const runScreening = createRoute({
    method: "post",
    path: "/api/jobs/{id}/screen",
    tags: ["Screening"],
    summary: "Ask the agent to screen this job's unscreened applicants",
    description:
      "Returns the brief either way. If the agent cannot be reached, `dispatched` is false and the brief is yours to paste into a chat with it — the app never silently does nothing.",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: ok(
        "Dispatched, or the brief to hand over",
        z.object({
          dispatched: z.boolean(),
          brief: z.string(),
          pending: z.number().int(),
          error: z.string().optional(),
          servers: z.array(z.record(z.unknown())).optional(),
        }),
      ),
      404: fail("No such job"),
      422: fail("Nothing to screen against"),
    },
  });

  app.openapi(runScreening, async (c) => {
    const { id } = c.req.valid("param");
    const job = await get<{ id: string; title: string }>("SELECT id, title FROM jobs WHERE id = ?", [id]);
    if (!job) return c.json({ error: "No such job" } as never, 404);

    const criterionCount = await get<{ n: number }>("SELECT COUNT(*) AS n FROM screening_criteria WHERE job_id = ?", [id]);
    if (!criterionCount?.n) {
      return c.json(
        { error: "This job has no requirements yet — add what the role needs before screening against it." } as never,
        422,
      );
    }
    const pending = await get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM applications a
        WHERE a.job_id = ? AND a.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM screening_results r WHERE r.application_id = a.id)`,
      [id],
    );

    const brief = screeningBrief({
      jobId: id,
      jobTitle: job.title,
      appUrl: new URL(c.req.url).origin,
      applicationCount: pending?.n ?? 0,
      criterionCount: criterionCount.n,
    });

    const config = await get<{ server_id: string }>("SELECT server_id FROM agent_config WHERE id = 1");
    const result = await dispatchTask(c.env, {
      instruction: brief,
      serverId: config?.server_id || null,
      // Keyed on the job and the size of the queue, so pressing the button twice
      // by accident is one task while a genuinely new batch is a new one.
      idempotencyKey: `screen:${id}:${pending?.n ?? 0}`,
    });

    if (result.ok) {
      await log(c, { kind: "screening", jobId: id, summary: `Handed ${pending?.n ?? 0} applicant(s) to the agent to screen` });
      return c.json({ dispatched: true, brief, pending: pending?.n ?? 0 } as never);
    }
    return c.json({ dispatched: false, brief, pending: pending?.n ?? 0, error: result.error, servers: result.servers } as never);
  });

  const screenOne = createRoute({
    method: "post",
    path: "/api/applications/{id}/screen",
    tags: ["Screening"],
    summary: "Ask the agent to screen one candidate",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: ok("Dispatched, or the brief to hand over", z.object({ dispatched: z.boolean(), brief: z.string(), error: z.string().optional() })),
      404: fail("No such application"),
    },
  });

  app.openapi(screenOne, async (c) => {
    const { id } = c.req.valid("param");
    const row = await get<{ id: string; candidate_name: string; job_title: string }>(
      `SELECT a.id, c.name AS candidate_name, j.title AS job_title
         FROM applications a JOIN candidates c ON c.id = a.candidate_id JOIN jobs j ON j.id = a.job_id
        WHERE a.id = ?`,
      [id],
    );
    if (!row) return c.json({ error: "No such application" } as never, 404);

    const brief = candidateBrief({
      applicationId: id,
      candidateName: row.candidate_name,
      jobTitle: row.job_title,
      appUrl: new URL(c.req.url).origin,
    });
    const config = await get<{ server_id: string }>("SELECT server_id FROM agent_config WHERE id = 1");
    const result = await dispatchTask(c.env, { instruction: brief, serverId: config?.server_id || null, idempotencyKey: `screen-one:${id}` });

    if (result.ok) return c.json({ dispatched: true, brief } as never);
    return c.json({ dispatched: false, brief, error: result.error } as never);
  });

  const agentStatus = createRoute({
    method: "get",
    path: "/api/agent",
    tags: ["Settings"],
    summary: "Whether screening can be handed to an agent, and which one",
    responses: {
      200: ok(
        "Agent availability",
        z.object({
          available: z.boolean(),
          reachable: z.boolean(),
          server_id: z.string().nullable(),
          servers: z.array(z.object({ id: z.string(), name: z.string().nullable(), status: z.string().nullable() })),
        }),
      ),
    },
  });

  app.openapi(agentStatus, async (c) => {
    const config = await get<{ server_id: string }>("SELECT server_id FROM agent_config WHERE id = 1");
    const servers = await listAgentServers(c.env);
    return c.json({
      available: dispatchAvailable(c.env),
      reachable: servers !== null,
      server_id: config?.server_id || null,
      servers: servers ?? [],
    } as never);
  });

  const setAgent = createRoute({
    method: "put",
    path: "/api/agent",
    tags: ["Settings"],
    summary: "Choose which agent screens candidates",
    request: { body: { content: { "application/json": { schema: z.object({ server_id: z.string() }) } } } },
    responses: { 200: ok("Saved", z.object({ server_id: z.string().nullable() })) },
  });

  app.openapi(setAgent, async (c) => {
    const { server_id } = c.req.valid("json");
    await run(
      "INSERT INTO agent_config (id, server_id, updated_at) VALUES (1, ?, datetime('now')) ON CONFLICT (id) DO UPDATE SET server_id = excluded.server_id, updated_at = datetime('now')",
      [server_id],
    );
    return c.json({ server_id: server_id || null } as never);
  });
}
