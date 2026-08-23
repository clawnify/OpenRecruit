// The shared vocabulary every route module imports: the bindings, the app type,
// and the handful of helpers that would otherwise be re-written per file.

import { OpenAPIHono, z } from "@clawnify/app";

export interface Env {
  Bindings: {
    DB: D1Database;
    /** Per-app bucket holding CVs, cover letters and careers-site imagery. */
    UPLOADS: R2Bucket;
    /** Minted per org by the platform; required to hand screening to the agent. */
    CLAWNIFY_TOKEN?: string;
    /** Optional, bring-your-own. Absent means messages are logged, never sent. */
    RESEND_API_KEY?: string;
    /** From address for candidate mail. Must be on a domain verified with the provider. */
    HIRING_FROM_EMAIL?: string;
    /** Override the platform agent endpoint — local testing only. */
    CLAWNIFY_AGENTS_URL?: string;
  };
}

export type App = OpenAPIHono<Env>;

export const uid = () => crypto.randomUUID();

export const ErrorSchema = z.object({ error: z.string() }).openapi("Error");
export const OkSchema = z.object({ ok: z.boolean() }).openapi("Ok");

export const PaginationQuery = z.object({
  page: z.string().optional().openapi({ description: "Page number (default: 1)" }),
  limit: z.string().optional().openapi({ description: "Items per page (default: 25, max: 100)" }),
});

export function paginate(q: { page?: string; limit?: string }): { limit: number; offset: number; page: number } {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 25));
  return { page, limit, offset: (page - 1) * limit };
}

export function ok<T extends z.ZodTypeAny>(description: string, schema: T) {
  return { description, content: { "application/json": { schema } } };
}

export function fail(description: string) {
  return { description, content: { "application/json": { schema: ErrorSchema } } };
}

/**
 * URL-safe handle for a job's public page.
 *
 * Uniqueness is enforced by the database, not here — this only has to produce
 * something readable to start from.
 */
export function slugify(text: string): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "role"
  );
}
