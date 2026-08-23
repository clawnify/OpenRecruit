// The public half of the app: the careers site, the application form, and the
// two machine-readable surfaces that get a job in front of people without buying
// a job-board slot.
//
// None of this is on the OpenAPI surface. These are plain Hono routes because
// the agent has no business calling them — it would be applying to jobs — and
// because every route the app publishes costs the agent context on every turn.
//
// **Everything here is reachable without authentication**, which is the point of
// a careers site and also the reason it is the most carefully written file in
// the repository. Read `escapeHtml` in markdown.ts before adding to it.

import { get, query, run } from "../db.js";
import { uid, type App } from "../env.js";
import { escapeHtml, renderMarkdown, toPlainText } from "../markdown.js";
import { applyKnockouts } from "./applications.js";
import { extract, isSupported } from "../extract.js";

/** A CV, not a film. Bounded so an unauthenticated route cannot fill the bucket. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

interface Settings {
  company_name: string;
  company_url: string;
  careers_url: string;
  tagline: string;
  intro_md: string;
  logo_key: string;
  hero_key: string;
  accent: string;
  privacy_url: string;
  consent_text: string;
}

interface PublicJob {
  id: string;
  slug: string;
  title: string;
  department: string;
  employment_type: string;
  workplace: string;
  location_city: string;
  location_region: string;
  location_country: string;
  location_postal: string;
  remote_region: string;
  description_md: string;
  requirements_md: string;
  benefits_md: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  salary_unit: string;
  salary_public: number;
  published_at: string | null;
  closes_at: string | null;
}

async function settings(): Promise<Settings> {
  const row = await get<Settings>(
    "SELECT company_name, company_url, careers_url, tagline, intro_md, logo_key, hero_key, accent, privacy_url, consent_text FROM settings WHERE id = 1",
  );
  return (
    row ?? {
      company_name: "",
      company_url: "",
      careers_url: "",
      tagline: "",
      intro_md: "",
      logo_key: "",
      hero_key: "",
      accent: "#dd5164",
      privacy_url: "",
      consent_text: "",
    }
  );
}

/**
 * The site's own absolute origin.
 *
 * Configured first, inferred second. Structured data and the feed must carry
 * absolute URLs, and an aggregator that receives the wrong host indexes pages
 * that do not exist — so the setting wins wherever it is set, and the request's
 * own origin is the fallback that makes a fresh install work before anyone has
 * been to the settings screen.
 */
function origin(requestUrl: string, careersUrl: string): string {
  const configured = (careersUrl ?? "").trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(configured)) return configured;
  return new URL(requestUrl).origin;
}

function locationLine(job: PublicJob): string {
  const parts = [job.location_city, job.location_region, job.location_country].filter(Boolean);
  const place = parts.join(", ");
  if (job.workplace === "remote") return job.remote_region ? `Remote · ${job.remote_region}` : "Remote";
  if (job.workplace === "hybrid") return place ? `Hybrid · ${place}` : "Hybrid";
  return place || "—";
}

function employmentLabel(value: string): string {
  return value.toLowerCase().replace(/_/g, "-").replace(/(^|\s)\S/g, (s) => s.toUpperCase());
}

function salaryLine(job: PublicJob): string {
  if (!job.salary_public || (!job.salary_min && !job.salary_max)) return "";
  const unit = job.salary_unit.toLowerCase();
  const money = (n: number) => `${job.salary_currency} ${n.toLocaleString("en-US")}`;
  if (job.salary_min && job.salary_max) return `${money(job.salary_min)} – ${money(job.salary_max)} per ${unit}`;
  return `${money(job.salary_min ?? job.salary_max ?? 0)} per ${unit}`;
}

/**
 * The JobPosting structured data.
 *
 * This is the free half of "multiposting": a posting Google can read is a
 * posting that appears in job search without an ad budget or a contract, and
 * the fields below are the ones its documentation names. `title`, `description`,
 * `datePosted`, `hiringOrganization` and `jobLocation` are required — a posting
 * missing any of them is simply not eligible, which is why the careers page
 * declines to emit the block at all rather than emitting an invalid one.
 *
 * `validThrough` matters more than it looks: a posting with no expiry is treated
 * as stale, and setting it to a past date is one of the documented ways to
 * withdraw a job. The route for a closed job returns 410 for the same reason.
 */
function jobPostingLd(job: PublicJob, s: Settings, base: string): string | null {
  const description = renderMarkdown([job.description_md, job.requirements_md, job.benefits_md].filter(Boolean).join("\n\n"));
  if (!job.title || !description || !job.published_at || !s.company_name || !job.location_country) return null;

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: job.title,
    description,
    datePosted: job.published_at.slice(0, 10),
    identifier: { "@type": "PropertyValue", name: s.company_name, value: job.slug },
    hiringOrganization: {
      "@type": "Organization",
      name: s.company_name,
      ...(s.company_url ? { sameAs: s.company_url } : {}),
      ...(s.logo_key ? { logo: `${base}/api/careers/logo` } : {}),
    },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        ...(job.location_city ? { addressLocality: job.location_city } : {}),
        ...(job.location_region ? { addressRegion: job.location_region } : {}),
        ...(job.location_postal ? { postalCode: job.location_postal } : {}),
        addressCountry: job.location_country,
      },
    },
    employmentType: job.employment_type,
    directApply: true,
  };

  if (job.closes_at) ld.validThrough = job.closes_at.slice(0, 10);
  if (job.workplace === "remote") {
    ld.jobLocationType = "TELECOMMUTE";
    // Only the country is safe to assert: the free-text region field holds
    // things like "EU, UTC±2", and a made-up AdministrativeArea is worse than
    // none. Google reads an absent requirement as "anywhere".
    if (job.location_country) {
      ld.applicantLocationRequirements = { "@type": "Country", name: job.location_country };
    }
  }
  if (job.salary_public && (job.salary_min || job.salary_max)) {
    const value: Record<string, unknown> = { "@type": "QuantitativeValue", unitText: job.salary_unit };
    if (job.salary_min && job.salary_max) {
      value.minValue = job.salary_min;
      value.maxValue = job.salary_max;
    } else {
      value.value = job.salary_min ?? job.salary_max;
    }
    ld.baseSalary = { "@type": "MonetaryAmount", currency: job.salary_currency, value };
  }

  // `</script>` inside a JSON string closes the block in an HTML parser even
  // though it is valid JSON. Escaping the slash keeps the JSON identical and the
  // page intact — the one escape a JSON-LD block always needs.
  return JSON.stringify(ld).replace(/<\//g, "<\\/");
}

/**
 * A string safe to paste into an inline `<script>`.
 *
 * `JSON.stringify` alone is not enough: it leaves `<` untouched, so a job titled
 * `</script><img onerror=…>` would close the block and the rest would be parsed
 * as markup. Escaping the angle brackets and the two line separators JavaScript
 * treats as newlines closes both holes and leaves the value identical once the
 * engine reads it.
 */
function jsString(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** The careers site's chrome. One stylesheet, inline, no external requests. */
function page(opts: { title: string; description: string; s: Settings; base: string; head?: string; body: string }): string {
  const accent = /^#[0-9a-f]{3,8}$/i.test(opts.s.accent) ? opts.s.accent : "#dd5164";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<meta name="description" content="${escapeHtml(opts.description.slice(0, 300))}">
<meta property="og:title" content="${escapeHtml(opts.title)}">
<meta property="og:description" content="${escapeHtml(opts.description.slice(0, 300))}">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--accent:${accent};--bg:#fff;--surface:#fff;--sunken:#f1f5f9;--fg:#1a202c;--muted:#475569;--faint:#94a3b8;--border:#e2e8f0}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--surface:#161b22;--sunken:#1c2128;--fg:#e6edf3;--muted:#9ba7b3;--faint:#6e7681;--border:#30363d}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:400 16px/1.6 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--fg);text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:2px}
a:hover{text-decoration-color:var(--fg)}
.wrap{max-width:56rem;margin:0 auto;padding:0 1.25rem}
header{border-bottom:1px solid var(--border)}
.brand{display:flex;align-items:center;gap:.75rem;height:4rem}
.brand img{height:2rem;width:auto}
.brand span{font-weight:600}
.hero{padding:3rem 0 2.5rem}
.hero h1{font-size:2rem;line-height:1.15;letter-spacing:-.02em;margin:0 0 .5rem}
.hero p{color:var(--muted);margin:0;max-width:42rem}
.eyebrow{font-size:.6875rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.jobs{list-style:none;margin:1rem 0 0;padding:0;border-top:1px solid var(--border)}
.jobs li{border-bottom:1px solid var(--border)}
.jobs a{display:flex;flex-wrap:wrap;align-items:baseline;gap:.25rem 1rem;padding:1.125rem .25rem;text-decoration:none}
.jobs a:hover{background:var(--sunken)}
.jobs .t{font-weight:600;flex:1 1 20rem}
.jobs .m{color:var(--muted);font-size:.875rem}
.chip{display:inline-block;border:1px solid var(--border);background:var(--sunken);color:var(--muted);border-radius:.25rem;padding:.125rem .5rem;font-size:.75rem;margin-right:.375rem}
main{padding:2.5rem 0 4rem}
h2{font-size:1.125rem;margin:2rem 0 .5rem}
h3,h4{font-size:1rem;margin:1.5rem 0 .5rem}
.body p{margin:0 0 1rem}
.body ul,.body ol{margin:0 0 1rem;padding-left:1.25rem}
.body li{margin:.25rem 0}
.btn{display:inline-flex;align-items:center;justify-content:center;background:var(--accent);color:#fff;border:0;border-radius:.25rem;padding:0 1rem;height:2.5rem;font:500 .9375rem Inter,sans-serif;cursor:pointer;text-decoration:none}
.btn:hover{filter:brightness(.92)}
.btn[disabled]{opacity:.5;cursor:not-allowed}
form{border-top:1px solid var(--border);margin-top:2.5rem;padding-top:2rem}
.field{margin:0 0 1.125rem}
label{display:block;font-size:.8125rem;font-weight:600;margin:0 0 .375rem}
.req{color:var(--accent)}
input[type=text],input[type=email],input[type=tel],input[type=url],input[type=number],input[type=date],textarea,select{width:100%;border:1px solid var(--border);background:var(--surface);color:var(--fg);border-radius:.25rem;padding:.5rem .625rem;font:400 .9375rem Inter,sans-serif}
textarea{min-height:6rem;resize:vertical}
input:focus,textarea:focus,select:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
.check{display:flex;gap:.625rem;align-items:flex-start;font-size:.875rem;font-weight:400;color:var(--muted)}
.check input{margin-top:.25rem}
.hint{color:var(--faint);font-size:.75rem;margin-top:.25rem}
.note{background:var(--sunken);border:1px solid var(--border);border-radius:.5rem;padding:1rem 1.125rem;color:var(--muted);font-size:.875rem}
.err{color:#b91c1c;font-size:.875rem;margin:.75rem 0 0}
footer{border-top:1px solid var(--border);color:var(--faint);font-size:.8125rem;padding:1.5rem 0}
.empty{color:var(--muted);padding:3rem 0;text-align:center}
</style>
${opts.head ?? ""}
</head>
<body>
<header><div class="wrap"><div class="brand">
${opts.s.logo_key ? `<img src="${opts.base}/api/careers/logo" alt="${escapeHtml(opts.s.company_name)}">` : ""}
<span>${escapeHtml(opts.s.company_name || "Careers")}</span>
</div></div></header>
${opts.body}
<footer><div class="wrap">
${opts.s.company_url ? `<a href="${escapeHtml(opts.s.company_url)}">${escapeHtml(opts.s.company_name)}</a> · ` : ""}
<a href="${opts.base}/careers">All openings</a>
${opts.s.privacy_url ? ` · <a href="${escapeHtml(opts.s.privacy_url)}">Privacy</a>` : ""}
</div></footer>
</body></html>`;
}

async function publishedJobs(): Promise<PublicJob[]> {
  return query<PublicJob>(
    `SELECT id, slug, title, department, employment_type, workplace, location_city, location_region,
            location_country, location_postal, remote_region, description_md, requirements_md, benefits_md,
            salary_min, salary_max, salary_currency, salary_unit, salary_public, published_at, closes_at
       FROM jobs
      WHERE status = 'published' AND (closes_at IS NULL OR closes_at >= date('now'))
      ORDER BY published_at DESC, title
      LIMIT 500`,
  );
}

export function registerPublic(app: App) {
  // ── The job board ───────────────────────────────────────────────────

  app.get("/careers", async (c) => {
    const s = await settings();
    const base = origin(c.req.url, s.careers_url);
    const jobs = await publishedJobs();

    const byDepartment = new Map<string, PublicJob[]>();
    for (const job of jobs) {
      const key = job.department || "Open roles";
      if (!byDepartment.has(key)) byDepartment.set(key, []);
      byDepartment.get(key)!.push(job);
    }

    const list = jobs.length
      ? [...byDepartment.entries()]
          .map(
            ([department, rows]) => `<section>
<p class="eyebrow" style="margin-top:2rem">${escapeHtml(department)} · ${rows.length}</p>
<ul class="jobs">${rows
              .map(
                (job) => `<li><a href="${base}/careers/${encodeURIComponent(job.slug)}">
<span class="t">${escapeHtml(job.title)}</span>
<span class="m">${escapeHtml(locationLine(job))} · ${escapeHtml(employmentLabel(job.employment_type))}</span>
</a></li>`,
              )
              .join("")}</ul></section>`,
          )
          .join("")
      : `<p class="empty">No openings right now. Check back soon.</p>`;

    return c.html(
      page({
        title: `Careers at ${s.company_name || "us"}`,
        description: s.tagline || toPlainText(s.intro_md).slice(0, 200),
        s,
        base,
        body: `<div class="wrap"><div class="hero">
<h1>${escapeHtml(s.tagline || `Join ${s.company_name || "the team"}`)}</h1>
${s.intro_md ? `<div class="body">${renderMarkdown(s.intro_md)}</div>` : ""}
</div></div>
<main><div class="wrap">${list}</div></main>`,
      }),
      200,
      { "Cache-Control": "public, max-age=300" },
    );
  });

  // ── One job ─────────────────────────────────────────────────────────

  app.get("/careers/:slug", async (c) => {
    const s = await settings();
    const base = origin(c.req.url, s.careers_url);
    const job = await get<PublicJob & { status: string }>(
      `SELECT id, slug, title, department, employment_type, workplace, location_city, location_region,
              location_country, location_postal, remote_region, description_md, requirements_md, benefits_md,
              salary_min, salary_max, salary_currency, salary_unit, salary_public, published_at, closes_at, status
         FROM jobs WHERE slug = ?`,
      [c.req.param("slug")],
    );

    // 410 rather than 404 for a job that existed and has closed: it is the
    // documented signal that a posting has been withdrawn, and it is the
    // difference between an aggregator removing the listing and retrying it.
    if (!job || job.status === "draft" || job.status === "archived") {
      return c.html(
        page({
          title: "Not found",
          description: "",
          s,
          base,
          body: `<main><div class="wrap"><p class="empty">That role isn't listed. <a href="${base}/careers">See all openings</a>.</p></div></main>`,
        }),
        404,
      );
    }
    const closed = job.status === "closed" || (job.closes_at != null && job.closes_at < new Date().toISOString().slice(0, 10));
    if (closed) {
      return c.html(
        page({
          title: `${job.title} — closed`,
          description: "",
          s,
          base,
          body: `<main><div class="wrap"><div class="hero"><h1>${escapeHtml(job.title)}</h1>
<p>This role is no longer accepting applications.</p></div>
<p><a class="btn" href="${base}/careers">See all openings</a></p></div></main>`,
        }),
        410,
      );
    }

    // Counted per day, in the background: nothing about the reader is stored,
    // and a failed counter must never cost the visitor their page.
    c.executionCtx.waitUntil(
      run(
        `INSERT INTO job_views (job_id, day, views) VALUES (?, date('now'), 1)
         ON CONFLICT (job_id, day) DO UPDATE SET views = views + 1`,
        [job.id],
      ).catch(() => {}),
    );

    const questions = await query<{ id: string; prompt: string; type: string; options: string; required: number }>(
      "SELECT id, prompt, type, options, required FROM job_questions WHERE job_id = ? ORDER BY position",
      [job.id],
    );
    const ld = jobPostingLd(job, s, base);
    const salary = salaryLine(job);

    const questionFields = questions
      .map((q) => {
        const label = `<label for="q_${q.id}">${escapeHtml(q.prompt)}${q.required ? ' <span class="req">*</span>' : ""}</label>`;
        const required = q.required ? " required" : "";
        const options = q.options
          .split("\n")
          .map((o) => o.trim())
          .filter(Boolean);

        if (q.type === "textarea") return `<div class="field">${label}<textarea id="q_${q.id}" name="q_${q.id}"${required}></textarea></div>`;
        if (q.type === "boolean") {
          return `<div class="field">${label}<select id="q_${q.id}" name="q_${q.id}"${required}>
<option value="">Choose…</option><option value="Yes">Yes</option><option value="No">No</option></select></div>`;
        }
        if (q.type === "single_choice" || q.type === "multi_choice") {
          return `<div class="field">${label}<select id="q_${q.id}" name="q_${q.id}"${q.type === "multi_choice" ? " multiple" : ""}${required}>
${q.type === "single_choice" ? '<option value="">Choose…</option>' : ""}
${options.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("")}</select></div>`;
        }
        const inputType = q.type === "number" ? "number" : q.type === "url" ? "url" : q.type === "date" ? "date" : "text";
        return `<div class="field">${label}<input type="${inputType}" id="q_${q.id}" name="q_${q.id}"${required}></div>`;
      })
      .join("");

    const body = `<div class="wrap"><div class="hero">
<p class="eyebrow">${escapeHtml(job.department || "Open role")}</p>
<h1>${escapeHtml(job.title)}</h1>
<p>
<span class="chip">${escapeHtml(locationLine(job))}</span>
<span class="chip">${escapeHtml(employmentLabel(job.employment_type))}</span>
${salary ? `<span class="chip">${escapeHtml(salary)}</span>` : ""}
</p>
</div></div>
<main><div class="wrap">
<div class="body">${renderMarkdown(job.description_md)}</div>
${job.requirements_md ? `<h2>What we're looking for</h2><div class="body">${renderMarkdown(job.requirements_md)}</div>` : ""}
${job.benefits_md ? `<h2>What we offer</h2><div class="body">${renderMarkdown(job.benefits_md)}</div>` : ""}

<form id="apply" method="post" action="${base}/api/careers/apply" enctype="multipart/form-data">
<h2 id="apply-heading">Apply for this role</h2>
<input type="hidden" name="job_id" value="${escapeHtml(job.id)}">
<div class="field"><label for="name">Your name <span class="req">*</span></label>
<input type="text" id="name" name="name" autocomplete="name" required></div>
<div class="field"><label for="email">Email <span class="req">*</span></label>
<input type="email" id="email" name="email" autocomplete="email" required></div>
<div class="field"><label for="phone">Phone</label>
<input type="tel" id="phone" name="phone" autocomplete="tel"></div>
<div class="field"><label for="cv">CV <span class="req">*</span></label>
<input type="file" id="cv" name="cv" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" required>
<p class="hint">PDF, Word or plain text, up to 10 MB. A scan with no text layer can't be read.</p></div>
<div class="field"><label for="letter">Anything you'd like to add</label>
<textarea id="letter" name="letter"></textarea></div>
${questionFields}
<div class="field"><label class="check">
<input type="checkbox" name="consent" value="yes" required>
<span>${escapeHtml(s.consent_text)}${s.privacy_url ? ` <a href="${escapeHtml(s.privacy_url)}">Privacy notice</a>.` : ""}</span>
</label></div>
<button class="btn" type="submit">Send application</button>
<p class="err" id="err" hidden></p>
</form>
</div></main>
<script>
// Submitted with fetch so the applicant stays on the page and gets a real
// answer. The form still has a working method/action, so it degrades to an
// ordinary POST if this never runs.
(function(){
  var form=document.getElementById('apply'),err=document.getElementById('err');
  form.addEventListener('submit',async function(e){
    e.preventDefault();
    var button=form.querySelector('button');button.disabled=true;err.hidden=true;
    try{
      var res=await fetch(form.action,{method:'POST',body:new FormData(form)});
      var data=await res.json().catch(function(){return{}});
      if(!res.ok)throw new Error(data.error||'Something went wrong. Please try again.');
      // Built as nodes with textContent rather than as an HTML string: the job
      // title is data, and this is the one place on the page where it would
      // otherwise be re-parsed as markup in the browser.
      var heading=document.createElement('h2');
      heading.textContent='Thanks \\u2014 we\\u2019ve got it.';
      var note=document.createElement('p');note.className='note';
      note.textContent='Your application for '+${jsString(job.title)}+
        ' is with the hiring team. We\\u2019ll be in touch by email.';
      form.replaceChildren(heading,note);
      form.scrollIntoView({behavior:'smooth',block:'start'});
    }catch(error){
      err.textContent=error.message;err.hidden=false;button.disabled=false;
    }
  });
})();
</script>`;

    return c.html(
      page({
        title: `${job.title} — ${s.company_name || "Careers"}`,
        description: toPlainText(job.description_md).slice(0, 250),
        s,
        base,
        head: ld ? `<script type="application/ld+json">${ld}</script>` : "",
        body,
      }),
      200,
      { "Cache-Control": "public, max-age=120" },
    );
  });

  // ── Applying ────────────────────────────────────────────────────────

  app.post("/api/careers/apply", async (c) => {
    const form = await c.req.formData().catch(() => null);
    if (!form) return c.json({ error: "That didn't arrive as a form." }, 400);

    const jobId = String(form.get("job_id") ?? "");
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const consent = String(form.get("consent") ?? "");

    const job = await get<{ id: string; title: string; status: string; closes_at: string | null }>(
      "SELECT id, title, status, closes_at FROM jobs WHERE id = ?",
      [jobId],
    );
    if (!job || job.status !== "published") return c.json({ error: "That role isn't accepting applications." }, 404);
    if (job.closes_at && job.closes_at < new Date().toISOString().slice(0, 10)) {
      return c.json({ error: "That role has closed." }, 410);
    }
    if (!name || !email) return c.json({ error: "Please give your name and email address." }, 422);
    // Consent is checked server-side as well as in the form: a record that says
    // someone agreed has to mean they actually did, and a `required` attribute
    // is a courtesy to the browser, not a control.
    if (consent !== "yes") return c.json({ error: "Please confirm the consent notice to apply." }, 422);

    const cv = form.get("cv");
    if (!(cv instanceof File) || cv.size === 0) return c.json({ error: "Please attach your CV." }, 422);
    if (cv.size > MAX_UPLOAD_BYTES) return c.json({ error: "That file is larger than 10 MB." }, 413);
    if (!isSupported(cv.name, cv.type)) {
      return c.json({ error: "We can read PDF, Word and plain text. A scanned image has no text we can read." }, 422);
    }

    const s = await settings();

    // One person, one record: someone applying to a second role is the same
    // candidate, which is the whole reason candidates and applications are
    // separate tables. Matched on email because that is what an applicant
    // controls and what the team will write to.
    const existing = await get<{ id: string }>("SELECT id FROM candidates WHERE email = ? AND email != ''", [email]);
    let candidateId = existing?.id ?? "";
    if (candidateId) {
      await run(
        `UPDATE candidates SET name = ?, phone = CASE WHEN ? != '' THEN ? ELSE phone END,
                consent_status = 'given', consent_text = ?, consent_at = datetime('now'),
                retain_until = NULL, updated_at = datetime('now')
          WHERE id = ?`,
        [name, String(form.get("phone") ?? ""), String(form.get("phone") ?? ""), s.consent_text, candidateId],
      );
    } else {
      candidateId = uid();
      await run(
        `INSERT INTO candidates (id, name, email, phone, source, consent_status, consent_text, consent_at)
         VALUES (?, ?, ?, ?, 'career_site', 'given', ?, datetime('now'))`,
        [candidateId, name, email, String(form.get("phone") ?? ""), s.consent_text],
      );
    }

    const already = await get<{ id: string }>("SELECT id FROM applications WHERE job_id = ? AND candidate_id = ?", [
      job.id,
      candidateId,
    ]);
    if (already) {
      return c.json({ error: "You've already applied for this role — we have your application." }, 409);
    }

    // The `applied` stage is where someone who applied themselves belongs —
    // never `sourced`, which means the team went looking for them. Falling back
    // to the first stage keeps a pipeline that was edited into an odd shape
    // working rather than dropping the application on the floor.
    const stage =
      (await get<{ id: string }>(
        "SELECT id FROM job_stages WHERE job_id = ? AND kind = 'applied' ORDER BY position LIMIT 1",
        [job.id],
      )) ?? (await get<{ id: string }>("SELECT id FROM job_stages WHERE job_id = ? ORDER BY position LIMIT 1", [job.id]));

    const applicationId = uid();
    await run(
      "INSERT INTO applications (id, job_id, candidate_id, stage_id, source) VALUES (?, ?, ?, ?, 'career_site')",
      [applicationId, job.id, candidateId, stage?.id ?? null],
    );

    // Store the file and read it in the same request. An applicant's CV that is
    // stored but never read is invisible to screening, and there is no second
    // visit from this person to retry on.
    const attachmentId = uid();
    const r2Key = `candidates/${candidateId}/${attachmentId}`;
    const bytes = await cv.arrayBuffer();
    await c.env.UPLOADS.put(r2Key, bytes, { httpMetadata: { contentType: cv.type || "application/octet-stream" } });
    await run(
      "INSERT INTO attachments (id, candidate_id, application_id, kind, name, r2_key, mime, size_bytes) VALUES (?, ?, ?, 'cv', ?, ?, ?, ?)",
      [attachmentId, candidateId, applicationId, cv.name, r2Key, cv.type, cv.size],
    );
    try {
      const { pages, locatorKind } = await extract(bytes, cv.name, cv.type);
      for (const p of pages) {
        await run("INSERT INTO attachment_pages (attachment_id, page_no, text) VALUES (?, ?, ?)", [attachmentId, p.page_no, p.text]);
      }
      await run("UPDATE attachments SET extract_status = 'ready', page_count = ?, locator_kind = ? WHERE id = ?", [
        pages.length,
        locatorKind,
        attachmentId,
      ]);
    } catch (err) {
      // The application still lands. A CV nobody can read is a screening
      // problem for the team, not a reason to turn the applicant away.
      await run("UPDATE attachments SET extract_status = 'failed', extract_error = ? WHERE id = ?", [
        (err as Error).message,
        attachmentId,
      ]);
    }

    const letter = String(form.get("letter") ?? "").trim();
    if (letter) {
      const letterId = uid();
      const letterKey = `candidates/${candidateId}/${letterId}`;
      await c.env.UPLOADS.put(letterKey, letter, { httpMetadata: { contentType: "text/plain" } });
      await run(
        "INSERT INTO attachments (id, candidate_id, application_id, kind, name, r2_key, mime, size_bytes, page_count, locator_kind, extract_status) VALUES (?, ?, ?, 'cover_letter', 'Cover note.txt', ?, 'text/plain', ?, 1, 'block', 'ready')",
        [letterId, candidateId, applicationId, letterKey, letter.length],
      );
      await run("INSERT INTO attachment_pages (attachment_id, page_no, text) VALUES (?, 1, ?)", [letterId, letter]);
    }

    const questions = await query<{ id: string }>("SELECT id FROM job_questions WHERE job_id = ?", [job.id]);
    for (const q of questions) {
      const values = form.getAll(`q_${q.id}`).map(String).filter(Boolean);
      if (values.length) {
        await run("INSERT INTO application_answers (application_id, question_id, value) VALUES (?, ?, ?)", [
          applicationId,
          q.id,
          values.join(", "),
        ]);
      }
    }
    await applyKnockouts(applicationId, job.id);

    await run(
      `INSERT INTO activity (id, candidate_id, application_id, job_id, kind, actor_kind, actor_name, summary, detail_json)
       VALUES (?, ?, ?, ?, 'applied', 'candidate', ?, ?, ?)`,
      [
        uid(),
        candidateId,
        applicationId,
        job.id,
        name,
        `Applied for ${job.title} through the careers site`,
        JSON.stringify({ source: "career_site", consent: true }),
      ],
    );

    return c.json({ ok: true, application_id: applicationId }, 201);
  });

  // ── Machine-readable surfaces ───────────────────────────────────────

  /**
   * A standard job feed.
   *
   * The other half of free distribution: aggregators and job boards that accept
   * a feed URL can pull every open role from here without an integration being
   * built for each one. The element names are the long-standing convention for
   * this format, and the content is wrapped in CDATA because job descriptions
   * are HTML.
   */
  app.get("/jobs.xml", async (c) => {
    const s = await settings();
    const base = origin(c.req.url, s.careers_url);
    const jobs = await publishedJobs();
    const cdata = (text: string) => `<![CDATA[${(text ?? "").replace(/]]>/g, "]]&gt;")}]]>`;

    const items = jobs
      .map((job) => {
        const description = renderMarkdown([job.description_md, job.requirements_md, job.benefits_md].filter(Boolean).join("\n\n"));
        return `<job>
<title>${cdata(job.title)}</title>
<date>${cdata((job.published_at ?? "").slice(0, 10))}</date>
<referencenumber>${cdata(job.slug)}</referencenumber>
<url>${cdata(`${base}/careers/${encodeURIComponent(job.slug)}`)}</url>
<company>${cdata(s.company_name)}</company>
<city>${cdata(job.location_city)}</city>
<state>${cdata(job.location_region)}</state>
<country>${cdata(job.location_country)}</country>
<postalcode>${cdata(job.location_postal)}</postalcode>
<department>${cdata(job.department)}</department>
<jobtype>${cdata(employmentLabel(job.employment_type))}</jobtype>
<remote>${cdata(job.workplace === "remote" ? "Yes" : "No")}</remote>
${job.salary_public && (job.salary_min || job.salary_max) ? `<salary>${cdata(salaryLine(job))}</salary>` : ""}
<description>${cdata(description)}</description>
</job>`;
      })
      .join("\n");

    return c.body(
      `<?xml version="1.0" encoding="utf-8"?>
<source>
<publisher>${cdata(s.company_name)}</publisher>
<publisherurl>${cdata(base)}</publisherurl>
<lastBuildDate>${cdata(new Date().toUTCString())}</lastBuildDate>
${items}
</source>`,
      200,
      { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=900" },
    );
  });

  /** Open roles as JSON, for the embeddable widget and for anyone's own site. */
  app.get("/api/careers/jobs", async (c) => {
    const s = await settings();
    const base = origin(c.req.url, s.careers_url);
    const jobs = await publishedJobs();
    return c.json(
      {
        company: s.company_name,
        jobs: jobs.map((job) => ({
          slug: job.slug,
          title: job.title,
          department: job.department,
          location: locationLine(job),
          employment_type: job.employment_type,
          workplace: job.workplace,
          url: `${base}/careers/${encodeURIComponent(job.slug)}`,
        })),
      },
      200,
      { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
    );
  });

  // The widget's own preflight. Without it the cross-origin fetch from a
  // company's marketing site is refused before it is made.
  app.options("/api/careers/jobs", (c) =>
    c.body(null, 204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Max-Age": "86400",
    }),
  );

  /**
   * The embeddable openings list.
   *
   * One script tag on a company's own website — usually a page nobody can add a
   * build step to — and the roles appear, styled by the host page rather than
   * fighting it. It writes only into its own container and inherits the host's
   * fonts and colours on purpose.
   */
  app.get("/widget.js", async (c) => {
    const s = await settings();
    const base = origin(c.req.url, s.careers_url);
    const script = `(function(){
  var mount=document.currentScript&&document.currentScript.parentNode;
  if(!mount)return;
  var box=document.createElement('div');box.className='open-recruit-jobs';mount.appendChild(box);
  fetch(${JSON.stringify(`${base}/api/careers/jobs`)}).then(function(r){return r.json()}).then(function(data){
    if(!data.jobs||!data.jobs.length){box.textContent='No openings right now.';return}
    var ul=document.createElement('ul');
    ul.style.cssText='list-style:none;margin:0;padding:0';
    data.jobs.forEach(function(job){
      var li=document.createElement('li');
      li.style.cssText='border-bottom:1px solid rgba(128,128,128,.25)';
      var a=document.createElement('a');
      a.href=job.url;a.target='_blank';a.rel='noopener';
      a.style.cssText='display:flex;flex-wrap:wrap;gap:.25rem 1rem;align-items:baseline;padding:.875rem 0;text-decoration:none;color:inherit';
      var t=document.createElement('span');t.textContent=job.title;t.style.cssText='font-weight:600;flex:1 1 15rem';
      var m=document.createElement('span');m.textContent=job.location+' \\u00b7 '+job.employment_type.toLowerCase().replace(/_/g,'-');
      m.style.cssText='opacity:.7;font-size:.875em';
      a.appendChild(t);a.appendChild(m);li.appendChild(a);ul.appendChild(li);
    });
    box.appendChild(ul);
  }).catch(function(){box.textContent='Openings are at ${base}/careers'});
})();`;
    return c.body(script, 200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600" });
  });

  // ── Careers-site imagery ────────────────────────────────────────────

  for (const kind of ["logo", "hero"] as const) {
    app.get(`/api/careers/${kind}`, async (c) => {
      const row = await get<Record<string, string>>(`SELECT ${kind}_key FROM settings WHERE id = 1`);
      const key = row?.[`${kind}_key`];
      if (!key) return c.body(null, 404);
      const object = await c.env.UPLOADS.get(key);
      if (!object) return c.body(null, 404);
      return new Response(object.body, {
        headers: {
          "Content-Type": object.httpMetadata?.contentType ?? "image/png",
          "Cache-Control": "public, max-age=3600",
        },
      });
    });
  }
}
