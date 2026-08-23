// The audit trail.
//
// One function, used by every route that changes something about a person. It is
// small on purpose: an audit log that is optional to write is an audit log with
// holes exactly where the interesting events are, so the cost of writing a row
// has to be one call with no ceremony.
//
// Why the app has one at all: a deployer of a high-risk AI system has to keep
// the logs its use generates and be able to explain an individual decision, and
// a candidate can ask what happened to their application. Neither question is
// answerable from current state — "disqualified" does not say who, when, or on
// what basis. Both are answered from this table.

import { run } from "./db.js";
import { uid } from "./env.js";
import { caller, user } from "@clawnify/app";
import type { Context } from "hono";

export type ActivityKind =
  | "applied"
  | "stage_changed"
  | "disqualified"
  | "restored"
  | "hired"
  | "note"
  | "evaluation"
  | "interview"
  | "message"
  | "screening"
  | "consent"
  | "tag"
  | "pool"
  | "job"
  | "purge";

/**
 * Who did this, from the platform-injected identity headers.
 *
 * The distinction that matters is machine vs person: an audit trail that cannot
 * tell an agent's action from a human's cannot answer the question it exists
 * for. `agent` and `agent-browser` are the same actor arriving two ways — one
 * through the API, one driving the UI in a real browser — so they collapse to
 * one kind, while a candidate acting on the public careers site is its own.
 */
function actorOf(c: Context): { kind: string; id: string; name: string } {
  const who = caller(c);
  if (who === "agent" || who === "agent-browser") return { kind: "agent", id: "", name: "Agent" };
  if (who === "system" || who === "app") return { kind: "system", id: "", name: "System" };
  const u = user(c);
  if (u) return { kind: "user", id: u.id, name: u.name || u.email || "" };
  return { kind: "system", id: "", name: "" };
}

export interface LogInput {
  kind: ActivityKind;
  summary: string;
  candidateId?: string | null;
  applicationId?: string | null;
  jobId?: string | null;
  detail?: Record<string, unknown>;
  /** Overrides the caller — used by the public apply route, where the actor is the applicant. */
  actor?: { kind: string; id?: string; name?: string };
}

export async function log(c: Context, input: LogInput): Promise<void> {
  const actor = input.actor
    ? { kind: input.actor.kind, id: input.actor.id ?? "", name: input.actor.name ?? "" }
    : actorOf(c);

  await run(
    `INSERT INTO activity (id, candidate_id, application_id, job_id, kind, actor_kind, actor_id, actor_name, summary, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uid(),
      input.candidateId ?? null,
      input.applicationId ?? null,
      input.jobId ?? null,
      input.kind,
      actor.kind,
      actor.id,
      actor.name,
      input.summary,
      JSON.stringify(input.detail ?? {}),
    ],
  );
}

/** The current person's name for an `author_name`-style column, or "". */
export function actorName(c: Context): string {
  const a = actorOf(c);
  return a.name;
}

/** The current person's platform id, or "" for an agent or the public site. */
export function actorId(c: Context): string {
  return actorOf(c).id;
}
