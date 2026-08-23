// Typed fetch wrapper. One place that knows the API returns JSON errors, so no
// screen has to remember to unwrap them.

export interface Job {
  id: string;
  slug: string;
  title: string;
  department: string;
  team: string;
  employment_type: string;
  experience_level: string;
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
  headcount: number;
  status: string;
  hiring_manager: string;
  published_at: string | null;
  closes_at: string | null;
  created_at: string;
  application_count?: number;
  active_count?: number;
  hired_count?: number;
  new_count?: number;
}

export interface Stage {
  id: string;
  job_id: string;
  position: number;
  name: string;
  kind: string;
  color: string;
  sla_days: number;
  count?: number;
}

export interface Criterion {
  id: string;
  job_id: string;
  position: number;
  key: string;
  label: string;
  detail: string;
  weight: string;
  type: string;
  options: string;
}

export interface Question {
  id: string;
  job_id: string;
  position: number;
  prompt: string;
  type: string;
  options: string;
  required: number;
  knockout_value: string;
}

export interface Application {
  id: string;
  job_id: string;
  candidate_id: string;
  stage_id: string | null;
  status: string;
  disqualify_reason: string;
  flagged_reason: string;
  source: string;
  applied_at: string;
  stage_entered_at: string;
  rating_avg: number | null;
  rating_count: number;
  candidate_name?: string;
  candidate_email?: string;
  candidate_headline?: string;
  job_title?: string;
  stage_name?: string;
  stage_kind?: string;
  days_in_stage?: number;
  overdue?: number;
  tags?: string[];
  screened?: number;
  must_have_met?: number;
  must_have_total?: number;
}

export interface Candidate {
  id: string;
  name: string;
  email: string;
  phone: string;
  headline: string;
  location: string;
  links_json: string;
  source: string;
  source_detail: string;
  consent_status: string;
  consent_at: string | null;
  retain_until: string | null;
  created_at: string;
  tags?: string[];
  application_count?: number;
}

export interface Attachment {
  id: string;
  candidate_id: string;
  kind: string;
  name: string;
  mime: string;
  size_bytes: number;
  page_count: number;
  locator_kind: string;
  extract_status: string;
  extract_error: string;
  created_at: string;
}

export interface ScreeningResult {
  id: string;
  criterion_id: string;
  criterion_key: string;
  criterion_label: string;
  weight: string;
  verdict: string;
  value: string;
  evidence_quote: string;
  attachment_id: string | null;
  attachment_name: string | null;
  page_no: number | null;
  status: string;
  rejected_reason: string;
  assessed_by: string;
  assessor: string;
  created_at: string;
}

export interface Note {
  id: string;
  candidate_id: string;
  author_name: string;
  body: string;
  visibility: string;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  due_at: string | null;
  done_at: string | null;
  candidate_id: string | null;
  candidate_name?: string;
  job_title?: string;
}

export interface Interview {
  id: string;
  application_id: string;
  title: string;
  kind: string;
  starts_at: string;
  ends_at: string | null;
  location: string;
  interviewers: string;
  status: string;
  candidate_name?: string;
  job_title?: string;
}

export interface Evaluation {
  id: string;
  author_name: string;
  overall: string;
  summary: string;
  scores_json: string;
  created_at: string;
}

export interface Message {
  id: string;
  direction: string;
  to_email: string;
  subject: string;
  body: string;
  status: string;
  error: string;
  sent_by: string;
  created_at: string;
}

export interface MessageTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  stage_kind: string;
}

export interface ActivityRow {
  id: string;
  kind: string;
  actor_kind: string;
  actor_name: string;
  summary: string;
  detail_json: string;
  created_at: string;
  candidate_id: string | null;
  candidate_name?: string | null;
  job_title?: string | null;
}

export interface Settings {
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
  retention_days: number;
  blind_until_position: number;
  hide_evaluations: number;
  can_send_email?: boolean;
}

export interface ProfileField {
  id: string;
  position: number;
  label: string;
  type: string;
  options: string;
}

export interface TalentPool {
  id: string;
  name: string;
  description: string;
  member_count: number;
}

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  // 422 is not an error on the screening route — it *is* the verification
  // result, and the caller needs the body to show which verdicts were rejected.
  if (!res.ok && res.status !== 422) throw new ApiError(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

const qs = (params: Record<string, string | number | undefined | null>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");

export const api = {
  // ── Dashboard & reports ───────────────────────────────────────────
  dashboard: () =>
    request<{
      open_jobs: number;
      published_jobs: number;
      active_candidates: number;
      new_this_week: number;
      awaiting_screening: number;
      flagged: number;
      overdue: number;
      my_tasks: number;
      jobs: (Job & { active_count: number; new_count: number })[];
      interviews: Interview[];
      tasks: Task[];
    }>("/api/dashboard"),

  reports: (params: { job_id?: string; days?: number } = {}) =>
    request<{
      window_days: number;
      totals: { candidates: number; hired: number; disqualified: number; active: number };
      time_to_hire_days: number | null;
      sources: { source: string; candidates: number; hired: number; hire_rate: number }[];
      funnel: { stage: string; position: number; reached: number }[];
      disqualify_reasons: { reason: string; count: number }[];
      over_time: { month: string; candidates: number; hired: number }[];
      jobs: { id: string; title: string; status: string; candidates: number; hired: number; views: number }[];
    }>(`/api/reports?${qs(params)}`),

  // ── Jobs ──────────────────────────────────────────────────────────
  jobs: (params: { search?: string; status?: string; limit?: number } = {}) =>
    request<{ jobs: Job[]; total: number }>(`/api/jobs?${qs({ limit: 50, ...params })}`),
  job: (id: string) =>
    request<Job & { stages: Stage[]; criteria: Criterion[]; questions: Question[] }>(`/api/jobs/${id}`),
  createJob: (body: Record<string, unknown>) => request<Job>("/api/jobs", { method: "POST", body: JSON.stringify(body) }),
  updateJob: (id: string, body: Record<string, unknown>) =>
    request<Job>(`/api/jobs/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteJob: (id: string) => request<{ ok: boolean }>(`/api/jobs/${id}`, { method: "DELETE" }),

  addStage: (jobId: string, body: { name: string; color?: string }) =>
    request<Stage>(`/api/jobs/${jobId}/stages`, { method: "POST", body: JSON.stringify(body) }),
  updateStage: (id: string, body: Record<string, unknown>) =>
    request<Stage>(`/api/stages/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteStage: (id: string) => request<{ ok: boolean; moved: number }>(`/api/stages/${id}`, { method: "DELETE" }),
  stageActions: (id: string) =>
    request<{ actions: { id: string; kind: string; config: string; position: number }[] }>(`/api/stages/${id}/actions`),
  putStageActions: (id: string, actions: { kind: string; config: Record<string, unknown> }[]) =>
    request<{ ok: boolean }>(`/api/stages/${id}/actions`, { method: "PUT", body: JSON.stringify({ actions }) }),

  putCriteria: (jobId: string, criteria: Record<string, unknown>[]) =>
    request<{ criteria: Criterion[] }>(`/api/jobs/${jobId}/criteria`, { method: "PUT", body: JSON.stringify({ criteria }) }),
  putQuestions: (jobId: string, questions: Record<string, unknown>[]) =>
    request<{ questions: Question[] }>(`/api/jobs/${jobId}/questions`, { method: "PUT", body: JSON.stringify({ questions }) }),

  pipelineTemplates: () =>
    request<{ templates: { id: string; name: string; description: string; stages_json: string }[] }>("/api/pipeline-templates"),
  savePipelineTemplate: (body: Record<string, unknown>) =>
    request<{ id: string }>("/api/pipeline-templates", { method: "POST", body: JSON.stringify(body) }),
  deletePipelineTemplate: (id: string) => request<{ ok: boolean }>(`/api/pipeline-templates/${id}`, { method: "DELETE" }),

  // ── Pipeline ──────────────────────────────────────────────────────
  board: (jobId: string) =>
    request<{
      job: { id: string; title: string; status: string };
      blind: boolean;
      stages: (Stage & { total: number; applications: Application[] })[];
      disqualified: number;
    }>(`/api/jobs/${jobId}/board`),

  applications: (jobId: string, params: Record<string, string | number | undefined> = {}) =>
    request<{ applications: Application[]; total: number }>(`/api/jobs/${jobId}/applications?${qs({ limit: 50, ...params })}`),
  application: (id: string) =>
    request<
      Application & {
        job: Job;
        candidate: Candidate;
        criteria: Criterion[];
        answers: { question_id: string; prompt: string; type: string; knockout_value: string; value: string }[];
        stages: Stage[];
      }
    >(`/api/applications/${id}`),
  moveStage: (id: string, stageId: string) =>
    request<Application & { actions_run: string[] }>(`/api/applications/${id}/stage`, {
      method: "POST",
      body: JSON.stringify({ stage_id: stageId }),
    }),
  disqualify: (id: string, reason: string, note?: string) =>
    request<Application>(`/api/applications/${id}/disqualify`, { method: "POST", body: JSON.stringify({ reason, note }) }),
  restore: (id: string) => request<Application>(`/api/applications/${id}/restore`, { method: "POST", body: "{}" }),
  bulk: (body: Record<string, unknown>) =>
    request<{ updated: number; skipped: { id: string; reason: string }[] }>("/api/applications/bulk", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  disqualifyReasons: () => request<{ reasons: { id: string; label: string }[] }>("/api/disqualify-reasons"),

  // ── Candidates ────────────────────────────────────────────────────
  candidates: (params: Record<string, string | number | undefined> = {}) =>
    request<{ candidates: Candidate[]; total: number }>(`/api/candidates?${qs({ limit: 50, ...params })}`),
  candidate: (id: string) =>
    request<
      Candidate & {
        attachments: Attachment[];
        applications: (Application & { job_title: string; stage_name: string })[];
        pools: { id: string; name: string }[];
      }
    >(`/api/candidates/${id}`),
  createCandidate: (body: Record<string, unknown>) =>
    request<Candidate & { application_id: string | null }>("/api/candidates", { method: "POST", body: JSON.stringify(body) }),
  updateCandidate: (id: string, body: Record<string, unknown>) =>
    request<Candidate>(`/api/candidates/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteCandidate: (id: string) =>
    request<{ ok: boolean; files_deleted: number }>(`/api/candidates/${id}`, { method: "DELETE" }),

  uploadAttachment: (candidateId: string, file: File, kind = "cv") => {
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    return request<Attachment>(`/api/candidates/${candidateId}/attachments`, { method: "POST", body: form });
  },
  extractAttachment: (id: string) => request<Attachment>(`/api/attachments/${id}/extract`, { method: "POST", body: "{}" }),
  deleteAttachment: (id: string) => request<{ ok: boolean }>(`/api/attachments/${id}`, { method: "DELETE" }),
  candidateText: (id: string, from = 0) =>
    request<{
      pages: { attachment_id: string; attachment_name: string; kind: string; page_no: number; text: string }[];
      total: number;
      next: number | null;
    }>(`/api/candidates/${id}/text?from=${from}`),
  candidateFields: (id: string) =>
    request<{ values: { field_id: string; label: string; type: string; options: string; value: string }[] }>(
      `/api/candidates/${id}/fields`,
    ),
  putCandidateFields: (id: string, values: { field_id: string; value: string }[]) =>
    request<{ ok: boolean }>(`/api/candidates/${id}/fields`, { method: "PUT", body: JSON.stringify({ values }) }),

  // ── Screening ─────────────────────────────────────────────────────
  screening: (applicationId: string) =>
    request<{ results: ScreeningResult[]; score: number | null; met: number; total: number }>(
      `/api/applications/${applicationId}/screening`,
    ),
  postScreening: (applicationId: string, results: Record<string, unknown>[]) =>
    request<{ accepted: number; rejected: Record<string, unknown>[]; score: number | null }>(
      `/api/applications/${applicationId}/screening`,
      { method: "POST", body: JSON.stringify({ results }) },
    ),
  screenJob: (jobId: string) =>
    request<{ dispatched: boolean; brief: string; pending: number; error?: string }>(`/api/jobs/${jobId}/screen`, {
      method: "POST",
      body: "{}",
    }),
  screenOne: (applicationId: string) =>
    request<{ dispatched: boolean; brief: string; error?: string }>(`/api/applications/${applicationId}/screen`, {
      method: "POST",
      body: "{}",
    }),

  // ── Collaboration ─────────────────────────────────────────────────
  notes: (candidateId: string) => request<{ notes: Note[]; total: number }>(`/api/candidates/${candidateId}/notes?limit=50`),
  addNote: (candidateId: string, body: Record<string, unknown>) =>
    request<Note>(`/api/candidates/${candidateId}/notes`, { method: "POST", body: JSON.stringify(body) }),
  deleteNote: (id: string) => request<{ ok: boolean }>(`/api/notes/${id}`, { method: "DELETE" }),

  tasks: (params: Record<string, string | undefined> = {}) =>
    request<{ tasks: Task[]; total: number }>(`/api/tasks?${qs({ limit: 50, ...params })}`),
  addTask: (body: Record<string, unknown>) => request<Task>("/api/tasks", { method: "POST", body: JSON.stringify(body) }),
  updateTask: (id: string, body: Record<string, unknown>) =>
    request<Task>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteTask: (id: string) => request<{ ok: boolean }>(`/api/tasks/${id}`, { method: "DELETE" }),

  interviews: (params: Record<string, string | undefined> = {}) =>
    request<{ interviews: Interview[]; total: number }>(`/api/interviews?${qs({ limit: 50, ...params })}`),
  scheduleInterview: (applicationId: string, body: Record<string, unknown>) =>
    request<Interview>(`/api/applications/${applicationId}/interviews`, { method: "POST", body: JSON.stringify(body) }),
  updateInterview: (id: string, body: Record<string, unknown>) =>
    request<Interview>(`/api/interviews/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  evaluations: (applicationId: string) =>
    request<{ evaluations: Evaluation[]; hidden: number; mine: boolean }>(`/api/applications/${applicationId}/evaluations`),
  addEvaluation: (applicationId: string, body: Record<string, unknown>) =>
    request<Evaluation>(`/api/applications/${applicationId}/evaluations`, { method: "POST", body: JSON.stringify(body) }),
  scorecards: () =>
    request<{ scorecards: { id: string; name: string; description: string; criteria_json: string }[] }>("/api/scorecards"),
  saveScorecard: (body: Record<string, unknown>) =>
    request<{ id: string }>("/api/scorecards", { method: "POST", body: JSON.stringify(body) }),
  deleteScorecard: (id: string) => request<{ ok: boolean }>(`/api/scorecards/${id}`, { method: "DELETE" }),

  activity: (params: Record<string, string | number | undefined> = {}) =>
    request<{ activity: ActivityRow[]; total: number }>(`/api/activity?${qs({ limit: 50, ...params })}`),

  // ── Messages ──────────────────────────────────────────────────────
  messages: (applicationId: string) =>
    request<{ messages: Message[]; total: number }>(`/api/applications/${applicationId}/messages?limit=50`),
  compose: (applicationId: string, templateId: string) =>
    request<{ subject: string; body: string; to_email: string; can_send: boolean }>(
      `/api/applications/${applicationId}/messages/compose`,
      { method: "POST", body: JSON.stringify({ template_id: templateId }) },
    ),
  sendMessage: (applicationId: string, body: Record<string, unknown>) =>
    request<Message>(`/api/applications/${applicationId}/messages`, { method: "POST", body: JSON.stringify(body) }),
  messageTemplates: () => request<{ templates: MessageTemplate[] }>("/api/message-templates"),
  saveMessageTemplate: (body: Record<string, unknown>) =>
    request<MessageTemplate>("/api/message-templates", { method: "POST", body: JSON.stringify(body) }),
  updateMessageTemplate: (id: string, body: Record<string, unknown>) =>
    request<MessageTemplate>(`/api/message-templates/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteMessageTemplate: (id: string) => request<{ ok: boolean }>(`/api/message-templates/${id}`, { method: "DELETE" }),

  // ── Talent pools ──────────────────────────────────────────────────
  pools: () => request<{ pools: TalentPool[] }>("/api/talent-pools"),
  createPool: (body: Record<string, unknown>) =>
    request<{ id: string }>("/api/talent-pools", { method: "POST", body: JSON.stringify(body) }),
  setPoolMember: (poolId: string, candidateId: string, member: boolean) =>
    request<{ ok: boolean }>(`/api/talent-pools/${poolId}/members`, {
      method: "POST",
      body: JSON.stringify({ candidate_id: candidateId, member }),
    }),
  deletePool: (id: string) => request<{ ok: boolean }>(`/api/talent-pools/${id}`, { method: "DELETE" }),

  // ── Settings ──────────────────────────────────────────────────────
  settings: () => request<Settings>("/api/settings"),
  updateSettings: (body: Record<string, unknown>) =>
    request<Settings>("/api/settings", { method: "PATCH", body: JSON.stringify(body) }),
  uploadImage: (kind: "logo" | "hero", file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ key: string }>(`/api/settings/images/${kind}`, { method: "POST", body: form });
  },
  profileFields: () => request<{ fields: ProfileField[] }>("/api/profile-fields"),
  putProfileFields: (fields: Record<string, unknown>[]) =>
    request<{ fields: ProfileField[] }>("/api/profile-fields", { method: "PUT", body: JSON.stringify({ fields }) }),

  retention: () =>
    request<{
      retention_days: number;
      due: { id: string; name: string; email: string; retain_until: string }[];
      due_count: number;
      upcoming_count: number;
    }>("/api/retention"),
  purge: () => request<{ erased: number; files_deleted: number; names: string[] }>("/api/retention/purge", {
    method: "POST",
    body: JSON.stringify({ confirm: true }),
  }),

  agent: () =>
    request<{
      available: boolean;
      reachable: boolean;
      server_id: string | null;
      servers: { id: string; name: string | null; status: string | null }[];
    }>("/api/agent"),
  setAgentServer: (serverId: string) =>
    request<{ server_id: string | null }>("/api/agent", { method: "PUT", body: JSON.stringify({ server_id: serverId }) }),
};
