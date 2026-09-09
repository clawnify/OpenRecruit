-- Open Recruit — schema.
--
-- No org_id column anywhere, deliberately: the platform provisions a separate
-- database per deployed app, so the database itself is the tenant boundary. A
-- column repeating one constant value would add no isolation, and filtering on
-- the org header would lock out the `agent-browser` caller (null for it) — the
-- agent driving these screens in a real browser.
--
-- Two ideas run through the whole model and are worth reading first:
--
--   1. **A candidate is a person, not an application.** Someone can apply to
--      three roles and sit in two talent pools; that is one `candidates` row and
--      three `applications` rows. Collapsing them is the mistake that makes an
--      ATS unable to answer "have we spoken to this person before?".
--
--   2. **Every AI judgement carries evidence that the app can find.** A
--      screening result is stored with a quote and the attachment + page it came
--      from, and the app locates that quote in the extracted text before it will
--      display the result. Recruitment AI is high-risk under the EU AI Act; an
--      unverifiable claim about a person's experience is the failure mode that
--      matters, so it is refused at the storage layer rather than styled
--      differently in the UI.

-- ── Company / careers site ────────────────────────────────────────────

-- Singleton by construction. Everything the public careers site needs to render
-- and everything the retention clock needs to run.
create table if not exists settings (
  id                integer primary key check (id = 1),
  company_name      text not null default '',
  company_url       text not null default '',
  -- Absolute origin the public careers site is served from. JSON-LD and the job
  -- feed must emit absolute URLs, and a Worker cannot always infer the public
  -- host behind a proxy — so it is configured, not guessed.
  careers_url       text not null default '',
  tagline           text not null default '',
  intro_md          text not null default '',
  logo_key          text not null default '',              -- object key, served via /api/careers/logo
  hero_key          text not null default '',
  accent            text not null default '#dd5164',
  privacy_url       text not null default '',
  -- Shown above the apply button and stored verbatim on every application, so
  -- an applicant's consent record survives a later edit of this text.
  consent_text      text not null default 'I agree that my application data may be stored and processed for this hiring process.',
  -- Days an unsuccessful applicant's data is kept before it may be purged.
  -- Six months is the common EU default; national guidance differs, so it is a
  -- setting rather than a constant.
  retention_days    integer not null default 180,
  -- Hide names and other identifying details on the board and in the screening
  -- grid until a candidate reaches the stage at this position. Bias in hiring is
  -- mostly not a decision anyone makes; it is a reaction to a name at the top of
  -- a CV, before the reading starts. 0 = off.
  blind_until_position integer not null default 0,
  -- Withhold colleagues' evaluations from an interviewer until they submit their
  -- own. The first opinion in the room otherwise becomes everybody's, and four
  -- agreeing scorecards then read as four independent judgements.
  hide_evaluations  integer not null default 1,
  updated_at        text not null default (datetime('now'))
);
-- The singleton settings row is created by the app (ensureSeeded in
-- src/server/index.ts): a deploy applies this file as DDL only.

-- ── Jobs ──────────────────────────────────────────────────────────────

create table if not exists jobs (
  id                text primary key,
  -- Public URL segment. Unique because it addresses the job on the careers site
  -- and is the stable `referencenumber` in the outbound feed.
  slug              text not null unique,
  title             text not null,
  department        text not null default '',
  team              text not null default '',
  -- schema.org employmentType, so the careers page can emit it unmapped:
  -- FULL_TIME | PART_TIME | CONTRACTOR | TEMPORARY | INTERN | VOLUNTEER | PER_DIEM | OTHER
  employment_type   text not null default 'FULL_TIME',
  experience_level  text not null default '',              -- e.g. junior | mid | senior | lead
  -- onsite | hybrid | remote. `remote` is what turns on jobLocationType in the
  -- structured data, which is what makes a posting show for remote searches.
  workplace         text not null default 'onsite',
  location_city     text not null default '',
  location_region   text not null default '',
  location_country  text not null default '',              -- ISO 3166-1 alpha-2
  location_postal   text not null default '',
  -- Where a remote hire may live. Free text ("EU, UTC±2"), rendered as-is.
  remote_region     text not null default '',
  description_md    text not null default '',
  requirements_md   text not null default '',
  benefits_md       text not null default '',
  salary_min        integer,
  salary_max        integer,
  salary_currency   text not null default 'EUR',
  salary_unit       text not null default 'YEAR',          -- HOUR | DAY | WEEK | MONTH | YEAR
  -- Pay transparency is now law in parts of the EU, but the app cannot know
  -- which regime applies — so publishing the range is a per-job decision.
  salary_public     integer not null default 0,
  headcount         integer not null default 1,
  status            text not null default 'draft',         -- draft | published | closed | archived
  hiring_manager    text not null default '',
  published_at      text,
  -- Structured data wants an expiry, and a posting with none is treated as stale
  -- by aggregators. Null means "until closed".
  closes_at         text,
  created_by        text not null default '',
  created_at        text not null default (datetime('now')),
  updated_at        text not null default (datetime('now'))
);
create index if not exists idx_jobs_status on jobs (status, published_at desc);

-- Careers-site analytics, kept to the two numbers a hiring team acts on: how
-- many people opened the posting, and how many of them applied. That ratio says
-- whether a job is failing to attract people or failing to convert them, and it
-- is the only question a view counter can honestly answer. Nothing here
-- identifies a visitor — no cookie, no address, no fingerprint.
create table if not exists job_views (
  job_id  text not null references jobs (id) on delete cascade,
  day     text not null,                                   -- YYYY-MM-DD
  views   integer not null default 0,
  primary key (job_id, day)
);

-- One column of the pipeline board.
--
-- `kind` is what makes a stage safe to reason about without reading its name.
-- Three of them are fixed: `sourced` is where someone the team approached
-- starts, `applied` is where someone who applied themselves starts, and `hired`
-- is where the pipeline ends. Those three cannot be deleted, because the rest of
-- the app is defined in terms of them — the apply form writes into `applied`,
-- sourcing writes into `sourced`, and time-to-hire measures the distance to
-- `hired`. Everything between is `custom` and the team's own business.
create table if not exists job_stages (
  id        text primary key,
  job_id    text not null references jobs (id) on delete cascade,
  position  integer not null default 0,
  name      text not null,
  kind      text not null default 'custom',                -- sourced | applied | custom | hired
  color     text not null default '',
  -- How long someone may sit here before the board flags them. The number that
  -- makes a pipeline honest: candidates are rarely rejected, they are forgotten,
  -- and a stage with no clock cannot tell the difference. 0 = no limit.
  sla_days  integer not null default 0,
  created_at text not null default (datetime('now'))
);
create index if not exists idx_stages_job on job_stages (job_id, position);

-- What happens on its own when someone lands in a stage.
--
-- Deliberately small: create a task, add a tag, or offer a message to send. It
-- stops short of sending mail unattended — a stage change that emails a person
-- with nobody looking is the one automation that can go wrong in a way you
-- cannot take back, so `message` prepares the mail and leaves the send to a
-- human. Everything an automation does is written to the activity log with
-- `actor_kind = 'system'`, so a rule cannot make changes nobody can trace.
create table if not exists stage_actions (
  id         text primary key,
  stage_id   text not null references job_stages (id) on delete cascade,
  kind       text not null,                                -- task | tag | message
  config     text not null default '{}',                   -- {title, due_days} | {tag} | {template_id}
  position   integer not null default 0,
  created_at text not null default (datetime('now'))
);
create index if not exists idx_stage_actions on stage_actions (stage_id, position);

-- A reusable pipeline. The point is that the second job starts from the first
-- one's proven shape instead of from a blank board.
create table if not exists pipeline_templates (
  id          text primary key,
  name        text not null,
  description text not null default '',
  stages_json text not null default '[]',                  -- [{name, kind, color}]
  is_default  integer not null default 0,
  created_at  text not null default (datetime('now'))
);

-- A question asked on the application form for one job.
create table if not exists job_questions (
  id        text primary key,
  job_id    text not null references jobs (id) on delete cascade,
  position  integer not null default 0,
  prompt    text not null,
  -- text | textarea | boolean | single_choice | multi_choice | number | url | date
  type      text not null default 'text',
  options   text not null default '',                      -- newline-separated, choice types only
  required  integer not null default 0,
  -- A factual disqualifier the employer defined ("do you hold a work permit for
  -- Germany?"). A mismatch FLAGS the application for review — it never rejects
  -- it. An automated rejection with no human in it is exactly the decision GDPR
  -- Art. 22 restricts, and the flag gets the same screening value without it.
  knockout_value text not null default ''
);
create index if not exists idx_questions_job on job_questions (job_id, position);

-- ── Candidates ────────────────────────────────────────────────────────

create table if not exists candidates (
  id            text primary key,
  name          text not null,
  email         text not null default '',
  phone         text not null default '',
  headline      text not null default '',                  -- "Senior Backend Engineer at Acme"
  location      text not null default '',
  links_json    text not null default '[]',                -- [{label, url}]
  -- Where the person came from: career_site | referral | sourced | agency | import | other
  source        text not null default 'career_site',
  source_detail text not null default '',                  -- referrer's name, agency, campaign
  -- given | withdrawn | unknown. `unknown` is honest for someone entered by hand
  -- or sourced — they never saw a consent notice, and pretending otherwise is
  -- the whole problem with consent fields that default to true.
  consent_status text not null default 'unknown',
  consent_text   text not null default '',                 -- what they actually agreed to
  consent_at     text,
  -- When this record becomes eligible for purge. Recomputed when an application
  -- closes; null while the person is still in an active process.
  retain_until   text,
  created_by     text not null default '',
  created_at     text not null default (datetime('now')),
  updated_at     text not null default (datetime('now'))
);
create index if not exists idx_candidates_email on candidates (email);
create index if not exists idx_candidates_created on candidates (created_at desc);
create index if not exists idx_candidates_retain on candidates (retain_until);

create table if not exists candidate_tags (
  candidate_id text not null references candidates (id) on delete cascade,
  tag          text not null,
  primary key (candidate_id, tag)
);
create index if not exists idx_tags_tag on candidate_tags (tag);

-- Custom fields on a candidate: the things this team tracks that no schema could
-- have guessed — notice period, day rate, security clearance, languages.
--
-- Defined once here rather than as columns, because the alternative is a schema
-- migration every time a recruiter wants a new box. `type` drives the input and
-- the sort order; `options` holds the choices for the choice types.
create table if not exists profile_fields (
  id       text primary key,
  position integer not null default 0,
  label    text not null,
  -- text | textarea | boolean | single_choice | multi_choice | number | date
  -- | salary | address | languages | skills | url
  type     text not null default 'text',
  options  text not null default '',                       -- newline-separated, choice types only
  -- Fields that read a person's protected characteristics are kept out of the
  -- ordinary set on purpose: they are special-category data, they must not
  -- inform a hiring decision, and a field that appears next to "notice period"
  -- on the profile invites exactly that. There is no such type above; if a team
  -- needs diversity monitoring it belongs in a separate, anonymised flow.
  created_at text not null default (datetime('now'))
);

create table if not exists candidate_field_values (
  candidate_id text not null references candidates (id) on delete cascade,
  field_id     text not null references profile_fields (id) on delete cascade,
  value        text not null default '',
  primary key (candidate_id, field_id)
);

-- Talent pools: a candidate who was good but not for this job. Membership is
-- many-to-many on purpose — "Berlin frontend" and "2026 grads" are both true.
create table if not exists talent_pools (
  id          text primary key,
  name        text not null,
  description text not null default '',
  created_at  text not null default (datetime('now'))
);

create table if not exists talent_pool_members (
  pool_id      text not null references talent_pools (id) on delete cascade,
  candidate_id text not null references candidates (id) on delete cascade,
  added_by     text not null default '',
  added_at     text not null default (datetime('now')),
  primary key (pool_id, candidate_id)
);

-- ── Applications ──────────────────────────────────────────────────────

-- One person, in one job's pipeline.
--
-- `stage_entered_at` exists so "days in stage" is a stored fact rather than a
-- reconstruction from the activity log. It is the number every stand-up asks
-- for and the one a pipeline report is built on.
create table if not exists applications (
  id                text primary key,
  job_id            text not null references jobs (id) on delete cascade,
  candidate_id      text not null references candidates (id) on delete cascade,
  stage_id          text references job_stages (id) on delete set null,
  -- active | disqualified | hired | withdrawn
  status            text not null default 'active',
  disqualify_reason text not null default '',
  disqualified_at   text,
  disqualified_by   text not null default '',
  -- Set when a knockout answer did not match, or when screening found a missing
  -- must-have. A flag for a human, never a decision.
  flagged_reason    text not null default '',
  source            text not null default 'career_site',
  applied_at        text not null default (datetime('now')),
  stage_entered_at  text not null default (datetime('now')),
  hired_at          text,
  -- Cached from evaluations so the board can show a score without N queries.
  rating_avg        real,
  rating_count      integer not null default 0,
  created_at        text not null default (datetime('now')),
  updated_at        text not null default (datetime('now'))
);
create unique index if not exists idx_app_unique on applications (job_id, candidate_id);
create index if not exists idx_app_job on applications (job_id, status, stage_id);
create index if not exists idx_app_candidate on applications (candidate_id);

create table if not exists application_answers (
  application_id text not null references applications (id) on delete cascade,
  question_id    text not null references job_questions (id) on delete cascade,
  value          text not null default '',
  primary key (application_id, question_id)
);

-- ── Files and their text ──────────────────────────────────────────────

-- The bytes live in object storage under `r2_key`; the *text* lives in
-- attachment_pages, because that is what screening evidence is checked against.
create table if not exists attachments (
  id             text primary key,
  candidate_id   text not null references candidates (id) on delete cascade,
  application_id text references applications (id) on delete set null,
  kind           text not null default 'cv',               -- cv | cover_letter | portfolio | other
  name           text not null,
  r2_key         text not null,
  mime           text not null default '',
  size_bytes     integer not null default 0,
  page_count     integer not null default 0,
  -- What page_no counts. A PDF has real pages; DOCX and plain text are split
  -- into fixed blocks, so "page 3" must not be read as a printed page 3.
  locator_kind   text not null default 'page',             -- page | block
  extract_status text not null default 'pending',          -- pending | ready | failed
  extract_error  text not null default '',
  created_at     text not null default (datetime('now'))
);
create index if not exists idx_attachments_candidate on attachments (candidate_id, created_at desc);

create table if not exists attachment_pages (
  attachment_id text not null references attachments (id) on delete cascade,
  page_no       integer not null,
  text          text not null default '',
  primary key (attachment_id, page_no)
);

-- ── Screening ─────────────────────────────────────────────────────────

-- What this job actually requires, written once.
create table if not exists screening_criteria (
  id          text primary key,
  job_id      text not null references jobs (id) on delete cascade,
  position    integer not null default 0,
  key         text not null,                               -- stable handle results are written against
  label       text not null,                               -- the column header; short
  -- The real instruction: what counts as meeting this, what to look for. The
  -- label is for the grid, this is for whoever answers.
  detail      text not null default '',
  weight      text not null default 'must_have',           -- must_have | nice_to_have
  type        text not null default 'boolean',             -- boolean | years | text | enum
  options     text not null default ''
);
create unique index if not exists idx_criteria_key on screening_criteria (job_id, key);

-- One judgement about one candidate against one requirement.
--
-- `status` is the point of this table:
--   verified — the quote was located in the candidate's own documents
--   rejected — a quote was offered and could NOT be found; the verdict is shown
--              as unverified and never counted, because an invented
--              qualification is worse than a blank cell when the subject is a
--              person's application
--   manual   — a human wrote it; no quote required, and the human is named
create table if not exists screening_results (
  id              text primary key,
  application_id  text not null references applications (id) on delete cascade,
  criterion_id    text not null references screening_criteria (id) on delete cascade,
  verdict         text not null default 'unclear',         -- met | not_met | unclear
  value           text not null default '',
  evidence_quote  text not null default '',
  attachment_id   text references attachments (id) on delete set null,
  page_no         integer,
  status          text not null default 'verified',        -- verified | rejected | manual
  rejected_reason text not null default '',
  -- Who produced this: agent | user. Recorded because a deployer of a high-risk
  -- AI system has to be able to say which judgements were machine-made.
  assessed_by     text not null default 'agent',
  assessor        text not null default '',
  created_at      text not null default (datetime('now'))
);
create unique index if not exists idx_results_slot on screening_results (application_id, criterion_id);
create index if not exists idx_results_app on screening_results (application_id, status);

-- ── Interviews, evaluations, collaboration ────────────────────────────

create table if not exists interviews (
  id             text primary key,
  application_id text not null references applications (id) on delete cascade,
  stage_id       text references job_stages (id) on delete set null,
  title          text not null default '',
  kind           text not null default 'interview',        -- phone_screen | interview | task | other
  starts_at      text not null,
  ends_at        text,
  location       text not null default '',                 -- room, or a meeting URL
  interviewers   text not null default '[]',               -- [{id, name}]
  notes          text not null default '',
  status         text not null default 'scheduled',        -- scheduled | done | cancelled
  created_by     text not null default '',
  created_at     text not null default (datetime('now'))
);
create index if not exists idx_interviews_app on interviews (application_id, starts_at);
create index if not exists idx_interviews_when on interviews (starts_at);

-- A reusable scorecard: the questions an interviewer answers, agreed before
-- anyone meets the candidate. Structured evaluation is the single cheapest
-- defence against a hiring decision that turns out to be a feeling.
create table if not exists scorecards (
  id            text primary key,
  name          text not null,
  description   text not null default '',
  criteria_json text not null default '[]',                -- [{key, label, detail}]
  created_at    text not null default (datetime('now'))
);

create table if not exists evaluations (
  id             text primary key,
  application_id text not null references applications (id) on delete cascade,
  interview_id   text references interviews (id) on delete set null,
  scorecard_id   text references scorecards (id) on delete set null,
  stage_id       text references job_stages (id) on delete set null,
  author_id      text not null default '',
  author_name    text not null default '',
  -- strong_no | no | yes | strong_yes — a four-point scale with no middle, so
  -- the answer is a recommendation rather than a shrug.
  overall        text not null default 'yes',
  summary        text not null default '',
  scores_json    text not null default '[]',               -- [{key, rating, comment}]
  created_at     text not null default (datetime('now'))
);
create index if not exists idx_evaluations_app on evaluations (application_id, created_at desc);

create table if not exists notes (
  id             text primary key,
  application_id text references applications (id) on delete cascade,
  candidate_id   text not null references candidates (id) on delete cascade,
  author_id      text not null default '',
  author_name    text not null default '',
  body           text not null,
  -- team | private. Private is the author's own; nothing in the app widens it.
  visibility     text not null default 'team',
  created_at     text not null default (datetime('now'))
);
create index if not exists idx_notes_candidate on notes (candidate_id, created_at desc);

create table if not exists tasks (
  id             text primary key,
  application_id text references applications (id) on delete cascade,
  candidate_id   text references candidates (id) on delete cascade,
  title          text not null,
  due_at         text,
  assignee_id    text not null default '',
  assignee_name  text not null default '',
  done_at        text,
  created_by     text not null default '',
  created_at     text not null default (datetime('now'))
);
create index if not exists idx_tasks_open on tasks (done_at, due_at);

-- ── Candidate communication ───────────────────────────────────────────

create table if not exists message_templates (
  id         text primary key,
  name       text not null,
  subject    text not null default '',
  body       text not null default '',                     -- {{candidate_name}}, {{job_title}}, {{company_name}}
  -- Offering the right template at the right moment is most of what makes
  -- rejections actually get sent. Null = available everywhere.
  stage_kind text not null default '',                     -- applied | custom | hired | disqualified
  created_at text not null default (datetime('now'))
);

create table if not exists messages (
  id             text primary key,
  application_id text not null references applications (id) on delete cascade,
  direction      text not null default 'out',              -- out | in
  to_email       text not null default '',
  subject        text not null default '',
  body           text not null default '',
  -- queued | sent | failed | logged. `logged` is a message the user sent from
  -- their own mail client and recorded here — with no mail provider configured
  -- that is the honest state, and it keeps the candidate's history complete.
  status         text not null default 'logged',
  error          text not null default '',
  provider_id    text not null default '',
  sent_by        text not null default '',
  created_at     text not null default (datetime('now'))
);
create index if not exists idx_messages_app on messages (application_id, created_at desc);

-- ── The record ────────────────────────────────────────────────────────

-- Append-only. Every state change that touches a person lands here.
--
-- This is not a UI convenience. A deployer of a high-risk AI system has to keep
-- the logs its use generated and be able to explain an individual decision; a
-- candidate can ask what happened to their application. Both questions are
-- answered from this table, which is why nothing in the app updates or deletes a
-- row in it — the only removal is the retention purge, which takes the person's
-- whole record together.
create table if not exists activity (
  id             text primary key,
  candidate_id   text references candidates (id) on delete cascade,
  application_id text references applications (id) on delete cascade,
  job_id         text references jobs (id) on delete cascade,
  -- applied | stage_changed | disqualified | restored | hired | note | evaluation
  -- | interview | message | screening | consent | tag | pool | purge_scheduled
  kind           text not null,
  -- user | agent | system | candidate — an audit trail that cannot distinguish a
  -- machine's action from a person's does not answer the question it exists for.
  actor_kind     text not null default 'user',
  actor_id       text not null default '',
  actor_name     text not null default '',
  summary        text not null default '',
  detail_json    text not null default '{}',
  created_at     text not null default (datetime('now'))
);
create index if not exists idx_activity_candidate on activity (candidate_id, created_at desc);
create index if not exists idx_activity_job on activity (job_id, created_at desc);
create index if not exists idx_activity_recent on activity (created_at desc);

-- Small fixed reference set: the reasons a team disqualifies someone. Kept as a
-- table so a team can add its own, seeded below with the common ones.
create table if not exists disqualify_reasons (
  id       text primary key,
  label    text not null,
  position integer not null default 0
);
-- The default disqualify reasons are seeded by the app (ensureSeeded in
-- src/server/index.ts), never here: this file is applied as DDL only.

-- Which agent screens candidates. A single row by construction: the choice is a
-- property of the deployment, not of any job. Left empty when the org has one
-- agent — the platform resolves it — and only set when there are several,
-- because then the platform refuses to guess.
create table if not exists agent_config (
  id         integer primary key check (id = 1),
  server_id  text not null default '',
  updated_at text default (datetime('now'))
);
