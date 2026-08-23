-- Demo data: one company, two open roles, six candidates part-way through.
--
-- The CV text below is real enough to exercise the evidence check: the verified
-- quotes are genuinely present in it, and the rejected one is genuinely absent
-- — which is why it is stored as unverified and counts for nothing. Re-running
-- screening against this data reproduces the same verdicts.
--
-- The stored file keys point at nothing, so "open the CV" will 404 on seeded
-- rows. Upload a real file to exercise that path.

delete from screening_results;
delete from screening_criteria;
delete from application_answers;
delete from job_questions;
delete from evaluations;
delete from interviews;
delete from notes;
delete from tasks;
delete from messages;
delete from activity;
delete from attachment_pages;
delete from attachments;
delete from applications;
delete from talent_pool_members;
delete from talent_pools;
delete from candidate_tags;
delete from candidate_field_values;
delete from profile_fields;
delete from stage_actions;
delete from job_stages;
delete from jobs;
delete from message_templates;
delete from pipeline_templates;

update settings set
  company_name = 'Northwind',
  company_url = 'https://example.com',
  tagline = 'Software for people who move things',
  intro_md = 'We build logistics software used by 400 carriers across Europe. Small team, long horizons, no theatre.

We hire for judgement over pedigree, and we say what we pay.',
  accent = '#dd5164',
  retention_days = 180,
  blind_until_position = 0,
  hide_evaluations = 1
where id = 1;

-- ── Jobs ──────────────────────────────────────────────────────────────

insert into jobs (id, slug, title, department, employment_type, experience_level, workplace,
                  location_city, location_country, description_md, requirements_md, benefits_md,
                  salary_min, salary_max, salary_currency, salary_unit, salary_public,
                  status, hiring_manager, published_at, closes_at)
values
  ('10000000-0000-4000-8000-000000000001', 'senior-backend-engineer', 'Senior Backend Engineer', 'Engineering',
   'FULL_TIME', '5+ years', 'hybrid', 'Berlin', 'DE',
   'We are looking for a backend engineer to own the routing service — the part of the product that decides which lorry goes where, and the part customers notice within seconds when it is wrong.

You would be the fourth engineer on a team of eleven. The service is TypeScript on Node, Postgres, and more queueing than any of us would like.',
   '- Several years writing production backend services, not just endpoints
- Comfortable owning a system in production: on-call, incidents, the boring parts
- Has run containers in anger rather than followed a tutorial
- Works in English; German is not required',
   '- €85–105k, stated up front and not negotiated down
- Four days a week in Berlin, one wherever you like
- A real training budget and the time to use it',
   85000, 105000, 'EUR', 'YEAR', 1,
   'published', 'Ines Fischer', datetime('now', '-21 days'), date('now', '+40 days')),

  ('10000000-0000-4000-8000-000000000002', 'customer-operations-lead', 'Customer Operations Lead', 'Operations',
   'FULL_TIME', '3-5 years', 'onsite', 'Rotterdam', 'NL',
   'Our carriers phone us when something goes wrong at 4am. You would run the team that answers.

This is an operational job with a real budget and real authority, not a coordination role.',
   '- Has run a support or operations team, with hiring and firing in it
- Comfortable with data: you will be asked why the queue looks like that
- Dutch and English',
   '- €55–70k
- Rotterdam office, four days',
   55000, 70000, 'EUR', 'YEAR', 1,
   'published', 'Marco de Vries', datetime('now', '-9 days'), null);

-- Pipeline: the two fixed entry stages, the team's own middle, and the end.
insert into job_stages (id, job_id, position, name, kind, color, sla_days) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 0, 'Sourced',   'sourced', '#94a3b8', 0),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 1, 'Applied',   'applied', '#64748b', 5),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 2, 'Screening', 'custom',  '#2563eb', 5),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 3, 'Interview', 'custom',  '#0d9488', 10),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 4, 'Offer',     'custom',  '#7c3aed', 7),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 5, 'Hired',     'hired',   '#047857', 0),
  ('20000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000002', 0, 'Sourced',   'sourced', '#94a3b8', 0),
  ('20000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000002', 1, 'Applied',   'applied', '#64748b', 5),
  ('20000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000002', 2, 'Screening', 'custom',  '#2563eb', 5),
  ('20000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000002', 3, 'Interview', 'custom',  '#0d9488', 10),
  ('20000000-0000-4000-8000-000000000015', '10000000-0000-4000-8000-000000000002', 4, 'Hired',     'hired',   '#047857', 0);

insert into pipeline_templates (id, name, description, stages_json, is_default) values
  ('2f000000-0000-4000-8000-000000000001', 'Standard', 'What most of our roles use.',
   '[{"name":"Sourced","kind":"sourced","color":"#94a3b8"},{"name":"Applied","kind":"applied","color":"#64748b"},{"name":"Screening","kind":"custom","color":"#2563eb"},{"name":"Interview","kind":"custom","color":"#0d9488"},{"name":"Offer","kind":"custom","color":"#7c3aed"},{"name":"Hired","kind":"hired","color":"#047857"}]', 1);

-- The requirements. The label is the grid header; the detail is the actual bar.
insert into screening_criteria (id, job_id, position, key, label, detail, weight, type) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 0, 'backend_years', 'Backend experience',
   'Five or more years writing production backend services. Internships and bootcamps do not count; a long stretch of frontend work with some Node in it does not either.', 'must_have', 'years'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 1, 'production_ownership', 'Owned a service in production',
   'Has been the person paged when it broke — on-call, incidents, post-mortems. Look for the word "owned", for on-call, or for a named system they were responsible for.', 'must_have', 'boolean'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 2, 'containers', 'Containers in production',
   'Has actually run containerised workloads, not just listed Docker in a skills row. A migration, a platform they built, or a cluster they operated.', 'must_have', 'boolean'),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 3, 'typescript', 'TypeScript',
   'Has written TypeScript in a real codebase. JavaScript alone is a partial match — say so in the value.', 'nice_to_have', 'boolean'),
  ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 4, 'led_others', 'Has led engineers',
   'Mentoring, tech lead or line management. Not required, but it changes the level we would hire at.', 'nice_to_have', 'boolean');

insert into job_questions (id, job_id, position, prompt, type, options, required, knockout_value) values
  ('35000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 0,
   'Do you already have the right to work in Germany?', 'boolean', '', 1, 'No'),
  ('35000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 1,
   'What is your notice period?', 'text', '', 0, ''),
  ('35000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 2,
   'Anything you would like us to know?', 'textarea', '', 0, '');

insert into profile_fields (id, position, label, type, options) values
  ('36000000-0000-4000-8000-000000000001', 0, 'Notice period', 'text', ''),
  ('36000000-0000-4000-8000-000000000002', 1, 'Salary expectation', 'salary', ''),
  ('36000000-0000-4000-8000-000000000003', 2, 'Languages', 'languages', '');

insert into message_templates (id, name, subject, body, stage_kind) values
  ('37000000-0000-4000-8000-000000000001', 'Interview invitation',
   'About your application for {{job_title}}',
   'Hello {{first_name}},

Thank you for applying for {{job_title}} at {{company_name}}. We have read your application and would like to talk.

Could you send me a couple of times that work for you next week? The conversation runs about 45 minutes.

Best,
', 'custom'),
  ('37000000-0000-4000-8000-000000000002', 'Not this time',
   'Your application for {{job_title}}',
   'Hello {{first_name}},

Thank you for taking the time to apply for {{job_title}}. We are not taking your application further this time.

To be useful rather than vague: we were looking for someone who has owned a service in production, and that was the part your application did not show. It is not a judgement about your work more broadly.

We would be glad to hear from you again.

Best,
', 'disqualified');

insert into talent_pools (id, name, description) values
  ('38000000-0000-4000-8000-000000000001', 'Berlin backend', 'Good engineers, wrong timing.');

-- ── Candidates ────────────────────────────────────────────────────────

insert into candidates (id, name, email, phone, headline, location, source, source_detail,
                        consent_status, consent_text, consent_at, created_at) values
  ('40000000-0000-4000-8000-000000000001', 'Maria Schneider', 'maria.schneider@example.com', '+49 30 1234567',
   'Staff Engineer at Acme GmbH', 'Berlin, Germany', 'career_site', '', 'given',
   'I agree that my application data may be stored and processed for this hiring process.', datetime('now', '-12 days'), datetime('now', '-12 days')),
  ('40000000-0000-4000-8000-000000000002', 'Tomasz Wójcik', 'tomasz.wojcik@example.com', '',
   'Backend Engineer at Kite', 'Kraków, Poland', 'career_site', '', 'given',
   'I agree that my application data may be stored and processed for this hiring process.', datetime('now', '-8 days'), datetime('now', '-8 days')),
  ('40000000-0000-4000-8000-000000000003', 'Amara Okonkwo', 'amara.okonkwo@example.com', '',
   'Senior Engineer, platform', 'Berlin, Germany', 'referral', 'Referred by Ines', 'given',
   'I agree that my application data may be stored and processed for this hiring process.', datetime('now', '-6 days'), datetime('now', '-6 days')),
  ('40000000-0000-4000-8000-000000000004', 'Jonas Bakker', 'jonas.bakker@example.com', '',
   'Frontend Developer', 'Utrecht, Netherlands', 'career_site', '', 'given',
   'I agree that my application data may be stored and processed for this hiring process.', datetime('now', '-4 days'), datetime('now', '-4 days')),
  ('40000000-0000-4000-8000-000000000005', 'Elena Ricci', 'elena.ricci@example.com', '',
   'Head of Support at Fleetly', 'Rotterdam, Netherlands', 'career_site', '', 'given',
   'I agree that my application data may be stored and processed for this hiring process.', datetime('now', '-3 days'), datetime('now', '-3 days')),
  ('40000000-0000-4000-8000-000000000006', 'Ravi Menon', 'ravi.menon@example.com', '',
   'Principal Engineer', 'Amsterdam, Netherlands', 'sourced', 'Found at a meetup', 'unknown', '', null, datetime('now', '-2 days'));

insert into candidate_tags (candidate_id, tag) values
  ('40000000-0000-4000-8000-000000000001', 'strong'),
  ('40000000-0000-4000-8000-000000000003', 'referral'),
  ('40000000-0000-4000-8000-000000000006', 'passive');

insert into talent_pool_members (pool_id, candidate_id, added_by) values
  ('38000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000006', 'Ines Fischer');

-- ── Applications ──────────────────────────────────────────────────────

insert into applications (id, job_id, candidate_id, stage_id, status, source, applied_at, stage_entered_at, flagged_reason) values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000004', 'active', 'career_site', datetime('now', '-12 days'), datetime('now', '-3 days'), ''),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000003', 'active', 'career_site', datetime('now', '-8 days'), datetime('now', '-8 days'), ''),
  ('50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003',
   '20000000-0000-4000-8000-000000000003', 'active', 'referral', datetime('now', '-6 days'), datetime('now', '-6 days'), ''),
  ('50000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000004',
   '20000000-0000-4000-8000-000000000002', 'active', 'career_site', datetime('now', '-4 days'), datetime('now', '-4 days'),
   'Answered “Do you already have the right to work in Germany?” in a way this job screens out'),
  ('50000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000005',
   '20000000-0000-4000-8000-000000000013', 'active', 'career_site', datetime('now', '-3 days'), datetime('now', '-3 days'), ''),
  ('50000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000006',
   '20000000-0000-4000-8000-000000000001', 'active', 'sourced', datetime('now', '-2 days'), datetime('now', '-2 days'), '');

insert into application_answers (application_id, question_id, value) values
  ('50000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000001', 'Yes'),
  ('50000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000002', '3 months'),
  ('50000000-0000-4000-8000-000000000002', '35000000-0000-4000-8000-000000000001', 'Yes'),
  ('50000000-0000-4000-8000-000000000002', '35000000-0000-4000-8000-000000000002', '1 month'),
  ('50000000-0000-4000-8000-000000000003', '35000000-0000-4000-8000-000000000001', 'Yes'),
  ('50000000-0000-4000-8000-000000000004', '35000000-0000-4000-8000-000000000001', 'No'),
  ('50000000-0000-4000-8000-000000000004', '35000000-0000-4000-8000-000000000003', 'I would need visa sponsorship but can start immediately.');

-- ── CVs ───────────────────────────────────────────────────────────────

insert into attachments (id, candidate_id, application_id, kind, name, r2_key, mime, size_bytes, page_count, locator_kind, extract_status) values
  ('60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
   'cv', 'Maria Schneider - CV.pdf', 'candidates/seed/a', 'application/pdf', 84213, 2, 'page', 'ready'),
  ('60000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002',
   'cv', 'Tomasz Wojcik CV.pdf', 'candidates/seed/b', 'application/pdf', 61002, 1, 'page', 'ready'),
  ('60000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000003',
   'cv', 'A Okonkwo resume.pdf', 'candidates/seed/c', 'application/pdf', 70110, 1, 'page', 'ready'),
  ('60000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000004',
   'cv', 'jonas-bakker.pdf', 'candidates/seed/d', 'application/pdf', 44880, 1, 'page', 'ready');

insert into attachment_pages (attachment_id, page_no, text) values
  ('60000000-0000-4000-8000-000000000001', 1,
   'MARIA SCHNEIDER
Staff Engineer — Berlin, Germany

EXPERIENCE

Acme GmbH — Staff Engineer (2021–present)
Led the migration of the billing platform to Kubernetes, cutting deploy time from 40 minutes to 6.
Owned the invoicing service end to end, including the on-call rotation for it.
Mentored three engineers through to senior.

Volt Logistics — Senior Backend Engineer (2017–2021)
Built the settlement pipeline in TypeScript and Node, processing about 200k events a day.'),
  ('60000000-0000-4000-8000-000000000001', 2,
   'EDUCATION
TU Berlin — MSc Computer Science, 2016

LANGUAGES
German (native), English (fluent)'),
  ('60000000-0000-4000-8000-000000000002', 1,
   'Tomasz Wójcik — Backend Engineer, Kraków

Kite (2022–present)
Backend engineer on the payments team. Wrote and maintained services in Go and some Node.
Took part in the on-call rotation from my second year.

Studio Nowa (2020–2022)
Junior then mid backend developer. REST APIs in Python, some Docker for local development.

SKILLS
Go, Python, Node.js, PostgreSQL, Docker, Git'),
  ('60000000-0000-4000-8000-000000000003', 1,
   'Amara Okonkwo
Senior Engineer, platform — Berlin

Kestrel (2019–present)
Platform engineer, then senior. I own the internal deployment platform: 60 services, roughly 200 deploys a week.
I have carried the pager for it for four years and written the post-mortems for two outages that made the news.
The platform runs on Kubernetes, which I introduced and then had to justify for eighteen months.
Everything is TypeScript except the operators, which are Go.

Before that: four years as a backend engineer at two logistics startups.'),
  ('60000000-0000-4000-8000-000000000004', 1,
   'Jonas Bakker — Frontend Developer, Utrecht

Rondo (2021–present)
Frontend developer. React, TypeScript, design systems. I have built and maintained our component library.
Occasionally write Node for build tooling.

Bright (2019–2021)
Junior frontend developer.

SKILLS
React, TypeScript, CSS, Figma, Node.js, Docker');

-- ── Screening ─────────────────────────────────────────────────────────
--
-- Maria was screened cleanly. Tomasz shows the interesting case: the fourth row
-- claims a container migration with a quote that is nowhere in his CV, so it is
-- stored as rejected — shown as unverified, and it does not count towards his
-- score. That is the whole app in one row.

insert into screening_results (id, application_id, criterion_id, verdict, value, evidence_quote,
                               attachment_id, page_no, status, rejected_reason, assessed_by, created_at) values
  ('70000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   'met', '9 years', 'Volt Logistics — Senior Backend Engineer (2017–2021)',
   '60000000-0000-4000-8000-000000000001', 1, 'verified', '', 'agent', datetime('now', '-11 days')),
  ('70000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002',
   'met', 'Owned invoicing, including on-call', 'Owned the invoicing service end to end, including the on-call rotation for it.',
   '60000000-0000-4000-8000-000000000001', 1, 'verified', '', 'agent', datetime('now', '-11 days')),
  ('70000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003',
   'met', 'Led a Kubernetes migration', 'Led the migration of the billing platform to Kubernetes',
   '60000000-0000-4000-8000-000000000001', 1, 'verified', '', 'agent', datetime('now', '-11 days')),
  ('70000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004',
   'met', 'TypeScript at Volt', 'Built the settlement pipeline in TypeScript and Node',
   '60000000-0000-4000-8000-000000000001', 1, 'verified', '', 'agent', datetime('now', '-11 days')),
  ('70000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000005',
   'met', 'Mentored three to senior', 'Mentored three engineers through to senior.',
   '60000000-0000-4000-8000-000000000001', 1, 'verified', '', 'agent', datetime('now', '-11 days')),

  ('70000000-0000-4000-8000-000000000011', '50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001',
   'met', 'About 6 years', 'Studio Nowa (2020–2022)',
   '60000000-0000-4000-8000-000000000002', 1, 'verified', '', 'agent', datetime('now', '-7 days')),
  ('70000000-0000-4000-8000-000000000012', '50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002',
   'met', 'On-call at Kite', 'Took part in the on-call rotation from my second year.',
   '60000000-0000-4000-8000-000000000002', 1, 'verified', '', 'agent', datetime('now', '-7 days')),
  ('70000000-0000-4000-8000-000000000013', '50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003',
   'met', 'Led a container migration', 'Migrated the payments platform to Kubernetes and ran the cluster',
   null, null, 'rejected',
   'evidence does not appear anywhere in this candidate''s documents. Copy the line verbatim from the CV — do not paraphrase it, and do not stitch two lines together.',
   'agent', datetime('now', '-7 days')),
  ('70000000-0000-4000-8000-000000000014', '50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000004',
   'unclear', 'Node listed, no detail', '', null, null, 'verified', '', 'agent', datetime('now', '-7 days')),
  ('70000000-0000-4000-8000-000000000015', '50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000005',
   'not_met', '', '', null, null, 'verified', '', 'agent', datetime('now', '-7 days')),

  ('70000000-0000-4000-8000-000000000021', '50000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001',
   'met', '10 years', 'Before that: four years as a backend engineer at two logistics startups.',
   '60000000-0000-4000-8000-000000000003', 1, 'verified', '', 'agent', datetime('now', '-5 days')),
  ('70000000-0000-4000-8000-000000000022', '50000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002',
   'met', 'Four years on the pager', 'I have carried the pager for it for four years',
   '60000000-0000-4000-8000-000000000003', 1, 'verified', '', 'agent', datetime('now', '-5 days')),
  ('70000000-0000-4000-8000-000000000023', '50000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003',
   'met', 'Introduced and ran Kubernetes', 'The platform runs on Kubernetes, which I introduced',
   '60000000-0000-4000-8000-000000000003', 1, 'verified', '', 'agent', datetime('now', '-5 days')),
  ('70000000-0000-4000-8000-000000000024', '50000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000004',
   'met', 'Everything but the operators', 'Everything is TypeScript except the operators',
   '60000000-0000-4000-8000-000000000003', 1, 'verified', '', 'agent', datetime('now', '-5 days')),
  ('70000000-0000-4000-8000-000000000025', '50000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000005',
   'unclear', 'Owns a platform, no team named', '', null, null, 'verified', '', 'agent', datetime('now', '-5 days'));

-- ── Around the candidates ─────────────────────────────────────────────

insert into notes (id, application_id, candidate_id, author_id, author_name, body, visibility, created_at) values
  ('80000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
   '', 'Ines Fischer', 'Strongest application so far. The Kubernetes migration is the exact problem we have.', 'team', datetime('now', '-10 days')),
  ('80000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002',
   '', 'Ines Fischer', 'The container claim did not check out against his CV — worth asking him directly rather than assuming.', 'team', datetime('now', '-6 days'));

insert into interviews (id, application_id, stage_id, title, kind, starts_at, ends_at, location, interviewers, status, created_by) values
  ('90000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004',
   'Technical conversation', 'interview', datetime('now', '+2 days', 'start of day', '+10 hours'),
   datetime('now', '+2 days', 'start of day', '+11 hours'), 'https://meet.example.com/northwind-1',
   '[{"name":"Ines Fischer"},{"name":"Piotr Nowak"}]', 'scheduled', 'Ines Fischer');

insert into evaluations (id, application_id, stage_id, author_id, author_name, overall, summary, scores_json, created_at) values
  ('a0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003',
   '', 'Piotr Nowak', 'strong_yes', 'Clear thinker. Walked through the billing migration without hiding the parts that went badly.', '[]', datetime('now', '-4 days'));

insert into tasks (id, application_id, candidate_id, title, due_at, assignee_name, created_by, created_at) values
  ('b0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002',
   'Ask Tomasz about the Kubernetes claim', date('now', '+1 day'), 'Ines Fischer', '', datetime('now', '-6 days')),
  ('b0000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000004',
   'Decide on Jonas — flagged for work permit', date('now'), 'Ines Fischer', '', datetime('now', '-4 days'));

insert into candidate_field_values (candidate_id, field_id, value) values
  ('40000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000001', '3 months'),
  ('40000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000002', '100000'),
  ('40000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000003', 'German, English');

insert into job_views (job_id, day, views) values
  ('10000000-0000-4000-8000-000000000001', date('now', '-3 days'), 84),
  ('10000000-0000-4000-8000-000000000001', date('now', '-2 days'), 121),
  ('10000000-0000-4000-8000-000000000001', date('now', '-1 days'), 96),
  ('10000000-0000-4000-8000-000000000002', date('now', '-1 days'), 37);

insert into activity (id, candidate_id, application_id, job_id, kind, actor_kind, actor_name, summary, detail_json, created_at) values
  ('c0000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', 'applied', 'candidate', 'Maria Schneider',
   'Applied for Senior Backend Engineer through the careers site', '{"source":"career_site","consent":true}', datetime('now', '-12 days')),
  ('c0000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', 'screening', 'agent', 'Agent',
   'Screened against 5 requirement(s) — 5 verified, 0 unverified', '{"accepted":5,"rejected":0,"score":100}', datetime('now', '-11 days')),
  ('c0000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', 'stage_changed', 'user', 'Ines Fischer',
   'Moved from Screening to Interview', '{"from":"Screening","to":"Interview"}', datetime('now', '-3 days')),
  ('c0000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002',
   '10000000-0000-4000-8000-000000000001', 'screening', 'agent', 'Agent',
   'Screened against 5 requirement(s) — 4 verified, 1 unverified', '{"accepted":4,"rejected":1,"score":67}', datetime('now', '-7 days'));
