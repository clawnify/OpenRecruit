import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ExternalLink, GripVertical, Plus, ScanSearch, Trash2 } from "lucide-react";
import { api, type Application, type Criterion, type Job, type Question, type Stage } from "../api";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  Empty,
  Eyebrow,
  Field,
  Input,
  Modal,
  Pill,
  Segmented,
  Select,
  Textarea,
  Toolbar,
  Zone,
} from "../components/ui";

type Tab = "pipeline" | "description" | "requirements" | "form" | "stages" | "promote";
type Board = Awaited<ReturnType<typeof api.board>>;

const KEY_FROM_LABEL = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "requirement";

export default function JobPage() {
  const { id = "" } = useParams();
  const [tab, setTab] = useState<Tab>("pipeline");
  const [job, setJob] = useState<(Job & { stages: Stage[]; criteria: Criterion[]; questions: Question[] }) | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const [next, nextBoard] = await Promise.all([api.job(id), api.board(id)]);
      setJob(next);
      setBoard(nextBoard);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(status: string) {
    try {
      await api.updateJob(id, { status });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function screen() {
    setNotice("");
    try {
      const result = await api.screenJob(id);
      setNotice(
        result.dispatched
          ? `Handed ${result.pending} applicant${result.pending === 1 ? "" : "s"} to your agent. Verdicts appear here as it works.`
          : `${result.error ?? "Your agent could not be reached."} Paste this into a chat with it instead:\n\n${result.brief}`,
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!job) {
    return (
      <>
        <Toolbar title="Job" />
        <div className="p-6">{error ? <p className="text-sm text-danger">{error}</p> : null}</div>
      </>
    );
  }

  return (
    <>
      <Toolbar title={job.title} subtitle={[job.department, job.status].filter(Boolean).join(" · ")}>
        {job.status === "published" ? (
          <a
            className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border bg-surface px-2 text-sm font-medium text-foreground hover:bg-sunken"
            href={`/careers/${job.slug}`}
            target="_blank"
            rel="noopener"
          >
            <ExternalLink className="size-4" />
            View
          </a>
        ) : null}
        {job.status === "draft" ? (
          <Button onClick={() => void setStatus("published")}>Publish</Button>
        ) : job.status === "published" ? (
          <Button onClick={() => void setStatus("closed")}>Close</Button>
        ) : (
          <Button onClick={() => void setStatus("published")}>Reopen</Button>
        )}
        <Button variant="primary" onClick={() => void screen()}>
          <ScanSearch className="size-4" />
          Screen applicants
        </Button>
      </Toolbar>

      <div className="p-6">
        {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}
        {notice ? (
          <div className="mb-4 whitespace-pre-wrap rounded-lg border border-border bg-sunken p-4 text-[0.8125rem] text-muted">
            {notice}
          </div>
        ) : null}

        <div className="mb-4">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "pipeline", label: "Pipeline" },
              { value: "description", label: "Description" },
              { value: "requirements", label: `Requirements${job.criteria.length ? ` (${job.criteria.length})` : ""}` },
              { value: "form", label: "Application form" },
              { value: "stages", label: "Stages" },
              { value: "promote", label: "Promote" },
            ]}
          />
        </div>

        {tab === "pipeline" ? <Pipeline board={board} onChange={load} setError={setError} /> : null}
        {tab === "description" ? <Description job={job} onSaved={load} /> : null}
        {tab === "requirements" ? <Requirements job={job} onSaved={load} /> : null}
        {tab === "form" ? <ApplicationForm job={job} onSaved={load} /> : null}
        {tab === "stages" ? <Stages job={job} onChange={load} setError={setError} /> : null}
        {tab === "promote" ? <Promote job={job} /> : null}
      </div>
    </>
  );
}

// ── Pipeline ──────────────────────────────────────────────────────────

function Pipeline({
  board,
  onChange,
  setError,
}: {
  board: Board | null;
  onChange: () => Promise<void>;
  setError: (message: string) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  async function move(applicationId: string, stageId: string) {
    try {
      const result = await api.moveStage(applicationId, stageId);
      if (result.actions_run?.length) setError("");
      await onChange();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!board) return null;
  const empty = board.stages.every((stage) => stage.applications.length === 0);

  return (
    <>
      {board.blind ? (
        <p className="mb-3 text-xs text-muted">
          Names are hidden in the early stages of this pipeline. Turn that off in Settings.
        </p>
      ) : null}

      {empty ? (
        <Empty
          title="Nobody in this pipeline yet."
          hint="Publish the job and applications land here, or add someone you have already spoken to from the Candidates page."
        />
      ) : (
        <div className="-mx-6 overflow-x-auto px-6">
          <div className="flex min-w-max gap-3 pb-2">
            {board.stages.map((stage) => (
              <div
                key={stage.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(stage.id);
                }}
                onDragLeave={() => setOver((current) => (current === stage.id ? null : current))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  if (dragging) void move(dragging, stage.id);
                  setDragging(null);
                }}
                className={`w-72 shrink-0 rounded-lg border p-2 transition-colors ${
                  over === stage.id ? "border-primary bg-[color-mix(in_srgb,var(--primary)_6%,transparent)]" : "border-transparent"
                }`}
              >
                <div className="flex items-center justify-between gap-2 px-1 pb-2">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: stage.color || "var(--faint)" }}
                      aria-hidden="true"
                    />
                    <span className="text-sm font-semibold">{stage.name}</span>
                  </span>
                  <span className="data text-[0.8125rem] text-muted">{stage.total}</span>
                </div>

                <div className="space-y-2">
                  {stage.applications.map((application) => (
                    <CandidateCard
                      key={application.id}
                      application={application}
                      stages={board.stages}
                      onDragStart={() => setDragging(application.id)}
                      onDragEnd={() => setDragging(null)}
                      onMove={(stageId) => void move(application.id, stageId)}
                    />
                  ))}
                  {stage.applications.length === 0 ? (
                    <p className="px-1 py-6 text-center text-xs text-faint">Empty</p>
                  ) : null}
                  {stage.total > stage.applications.length ? (
                    <p className="px-1 text-center text-[0.6875rem] text-faint">
                      +{stage.total - stage.applications.length} more
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {board.disqualified > 0 ? (
        <p className="mt-4 text-xs text-muted">
          {board.disqualified} disqualified candidate{board.disqualified === 1 ? " is" : "s are"} not shown here.
        </p>
      ) : null}
    </>
  );
}

function CandidateCard({
  application,
  stages,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  application: Application;
  stages: Stage[];
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (stageId: string) => void;
}) {
  const score =
    application.must_have_total && application.must_have_total > 0
      ? Math.round(((application.must_have_met ?? 0) / application.must_have_total) * 100)
      : null;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="group rounded-lg border border-border bg-surface p-2.5 transition-colors hover:bg-sunken"
    >
      <div className="flex items-start gap-2">
        <GripVertical className="mt-0.5 size-3.5 shrink-0 text-faint" aria-hidden="true" />
        <Avatar name={application.candidate_name ?? "?"} size={24} />
        <div className="min-w-0 flex-1">
          <Link to={`/applications/${application.id}`} className="link block truncate text-[0.8125rem] font-medium">
            {application.candidate_name}
          </Link>
          {application.candidate_headline ? (
            <p className="truncate text-[0.6875rem] text-muted">{application.candidate_headline}</p>
          ) : null}
        </div>
        {score !== null ? (
          <span
            className="data shrink-0 text-[0.6875rem] font-semibold text-success"
            title={`${application.must_have_met} of ${application.must_have_total} must-haves verified`}
          >
            {score}%
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {application.overdue ? <Badge tone="warning">{application.days_in_stage}d here</Badge> : null}
        {application.flagged_reason ? <Badge tone="warning">Flagged</Badge> : null}
        {!application.screened ? <Chip>Not screened</Chip> : null}
        {(application.tags ?? []).slice(0, 2).map((tag) => (
          <Pill key={tag}>{tag}</Pill>
        ))}
      </div>

      {/* Always a real control, never drag-only: dragging is invisible to an
          agent driving this in a browser, and to anyone using a keyboard. */}
      <Select
        aria-label={`Move ${application.candidate_name} to another stage`}
        value={application.stage_id ?? ""}
        onChange={(e) => onMove(e.target.value)}
        className="mt-2 h-7 text-[0.6875rem]"
      >
        {stages.map((stage) => (
          <option key={stage.id} value={stage.id}>
            {stage.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

// ── Description ───────────────────────────────────────────────────────

function Description({ job, onSaved }: { job: Job; onSaved: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(form: HTMLFormElement) {
    const data = new FormData(form);
    setSaving(true);
    try {
      await api.updateJob(job.id, {
        title: String(data.get("title") ?? ""),
        department: String(data.get("department") ?? ""),
        employment_type: String(data.get("employment_type") ?? "FULL_TIME"),
        experience_level: String(data.get("experience_level") ?? ""),
        workplace: String(data.get("workplace") ?? "onsite"),
        location_city: String(data.get("location_city") ?? ""),
        location_region: String(data.get("location_region") ?? ""),
        location_country: String(data.get("location_country") ?? ""),
        location_postal: String(data.get("location_postal") ?? ""),
        remote_region: String(data.get("remote_region") ?? ""),
        description_md: String(data.get("description_md") ?? ""),
        requirements_md: String(data.get("requirements_md") ?? ""),
        benefits_md: String(data.get("benefits_md") ?? ""),
        salary_min: data.get("salary_min") ? Number(data.get("salary_min")) : null,
        salary_max: data.get("salary_max") ? Number(data.get("salary_max")) : null,
        salary_currency: String(data.get("salary_currency") ?? "EUR"),
        salary_unit: String(data.get("salary_unit") ?? "YEAR"),
        salary_public: data.get("salary_public") === "on",
        closes_at: String(data.get("closes_at") ?? "") || null,
      });
      await onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(e.currentTarget);
      }}
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Zone>
            <Eyebrow>The posting</Eyebrow>
            <div className="mt-3 space-y-3">
              <Field label="Job title">
                <Input name="title" defaultValue={job.title} required />
              </Field>
              <Field label="About the role" hint="Markdown: headings, lists, bold, links.">
                <Textarea name="description_md" defaultValue={job.description_md} className="min-h-40" />
              </Field>
              <Field label="What we're looking for">
                <Textarea name="requirements_md" defaultValue={job.requirements_md} className="min-h-32" />
              </Field>
              <Field label="What we offer">
                <Textarea name="benefits_md" defaultValue={job.benefits_md} className="min-h-24" />
              </Field>
            </div>
          </Zone>
        </Card>

        <div className="space-y-4">
          <Card>
            <Zone>
              <Eyebrow>Details</Eyebrow>
              <div className="mt-3 space-y-3">
                <Field label="Department">
                  <Input name="department" defaultValue={job.department} />
                </Field>
                <Field label="Employment type">
                  <Select name="employment_type" defaultValue={job.employment_type}>
                    {["FULL_TIME", "PART_TIME", "CONTRACTOR", "TEMPORARY", "INTERN", "VOLUNTEER", "PER_DIEM", "OTHER"].map(
                      (value) => (
                        <option key={value} value={value}>
                          {value.toLowerCase().replace(/_/g, " ")}
                        </option>
                      ),
                    )}
                  </Select>
                </Field>
                <Field label="Experience">
                  <Input name="experience_level" defaultValue={job.experience_level} placeholder="e.g. 3-5 years" />
                </Field>
                <Field label="Closes on" hint="Job search engines treat a posting with no end date as stale.">
                  <Input type="date" name="closes_at" defaultValue={job.closes_at?.slice(0, 10) ?? ""} />
                </Field>
              </div>
            </Zone>
            <Zone>
              <Eyebrow>Where</Eyebrow>
              <div className="mt-3 space-y-3">
                <Field label="Workplace">
                  <Select name="workplace" defaultValue={job.workplace}>
                    <option value="onsite">On site</option>
                    <option value="hybrid">Hybrid</option>
                    <option value="remote">Remote</option>
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="City">
                    <Input name="location_city" defaultValue={job.location_city} />
                  </Field>
                  <Field label="Region">
                    <Input name="location_region" defaultValue={job.location_region} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Country" hint="Two letters.">
                    <Input name="location_country" defaultValue={job.location_country} maxLength={2} className="uppercase" />
                  </Field>
                  <Field label="Postcode">
                    <Input name="location_postal" defaultValue={job.location_postal} />
                  </Field>
                </div>
                <Field label="Remote from" hint="Only used when the workplace is remote.">
                  <Input name="remote_region" defaultValue={job.remote_region} placeholder="e.g. Anywhere in the EU" />
                </Field>
              </div>
            </Zone>
            <Zone>
              <Eyebrow>Pay</Eyebrow>
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="From">
                    <Input type="number" name="salary_min" defaultValue={job.salary_min ?? ""} />
                  </Field>
                  <Field label="To">
                    <Input type="number" name="salary_max" defaultValue={job.salary_max ?? ""} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Currency">
                    <Input name="salary_currency" defaultValue={job.salary_currency} maxLength={3} className="uppercase" />
                  </Field>
                  <Field label="Per">
                    <Select name="salary_unit" defaultValue={job.salary_unit}>
                      {["HOUR", "DAY", "WEEK", "MONTH", "YEAR"].map((unit) => (
                        <option key={unit} value={unit}>
                          {unit.toLowerCase()}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <label className="flex items-start gap-2 text-[0.8125rem] text-muted">
                  <input type="checkbox" name="salary_public" defaultChecked={job.salary_public === 1} className="mt-0.5" />
                  <span>Show the range on the public posting</span>
                </label>
              </div>
            </Zone>
          </Card>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {saved ? <span className="text-xs text-success">Saved</span> : null}
      </div>
    </form>
  );
}

// ── Requirements ──────────────────────────────────────────────────────

interface DraftCriterion {
  key: string;
  label: string;
  detail: string;
  weight: string;
  type: string;
}

function Requirements({ job, onSaved }: { job: Job & { criteria: Criterion[] }; onSaved: () => Promise<void> }) {
  const [rows, setRows] = useState<DraftCriterion[]>(
    job.criteria.map((c) => ({ key: c.key, label: c.label, detail: c.detail, weight: c.weight, type: c.type })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function update(index: number, patch: Partial<DraftCriterion>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await api.putCriteria(
        job.id,
        rows
          .filter((row) => row.label.trim())
          .map((row) => ({ ...row, key: row.key || KEY_FROM_LABEL(row.label) })),
      );
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <Zone>
        <Eyebrow right={`${rows.filter((r) => r.weight === "must_have").length} must-have`}>What this role requires</Eyebrow>
        <p className="mt-2 max-w-2xl text-[0.8125rem] text-muted">
          These are what a candidate is screened against. The label is the column header; the detail is the actual bar —
          &ldquo;Kubernetes&rdquo; against &ldquo;has run it in production, not just a course&rdquo;. Only must-haves count
          towards a candidate&rsquo;s match score, and only when the evidence checks out.
        </p>
      </Zone>

      <Zone>
        {rows.length === 0 ? (
          <Empty title="No requirements yet." hint="Add what the role actually needs before screening anyone against it." />
        ) : (
          <div className="space-y-3">
            {rows.map((row, index) => (
              <div key={index} className="rounded-lg border border-border p-3">
                <div className="flex items-start gap-2">
                  <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_9rem_8rem]">
                    <Input
                      value={row.label}
                      placeholder="Requirement, e.g. Production Kubernetes"
                      onChange={(e) =>
                        update(index, { label: e.target.value, key: row.key || KEY_FROM_LABEL(e.target.value) })
                      }
                    />
                    <Select value={row.weight} onChange={(e) => update(index, { weight: e.target.value })}>
                      <option value="must_have">Must have</option>
                      <option value="nice_to_have">Nice to have</option>
                    </Select>
                    <Select value={row.type} onChange={(e) => update(index, { type: e.target.value })}>
                      <option value="boolean">Yes / no</option>
                      <option value="years">Years</option>
                      <option value="text">Text</option>
                      <option value="enum">Choice</option>
                    </Select>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                    title="Remove"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <Textarea
                  value={row.detail}
                  placeholder="What counts as meeting this? The substance belongs here."
                  onChange={(e) => update(index, { detail: e.target.value })}
                  className="mt-2 min-h-16"
                />
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <Button
            onClick={() =>
              setRows((current) => [...current, { key: "", label: "", detail: "", weight: "must_have", type: "boolean" }])
            }
          >
            <Plus className="size-4" />
            Add requirement
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save requirements"}
          </Button>
          {error ? <span className="text-xs text-danger">{error}</span> : null}
        </div>
      </Zone>
    </Card>
  );
}

// ── Application form ──────────────────────────────────────────────────

interface DraftQuestion {
  prompt: string;
  type: string;
  options: string;
  required: boolean;
  knockout_value: string;
}

function ApplicationForm({ job, onSaved }: { job: Job & { questions: Question[] }; onSaved: () => Promise<void> }) {
  const [rows, setRows] = useState<DraftQuestion[]>(
    job.questions.map((q) => ({
      prompt: q.prompt,
      type: q.type,
      options: q.options,
      required: q.required === 1,
      knockout_value: q.knockout_value,
    })),
  );
  const [saving, setSaving] = useState(false);

  function update(index: number, patch: Partial<DraftQuestion>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function save() {
    setSaving(true);
    try {
      await api.putQuestions(
        job.id,
        rows.filter((row) => row.prompt.trim()).map((row) => ({ ...row })),
      );
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  const choice = (type: string) => type === "single_choice" || type === "multi_choice";

  return (
    <Card>
      <Zone>
        <Eyebrow>Questions on the application form</Eyebrow>
        <p className="mt-2 max-w-2xl text-[0.8125rem] text-muted">
          Name, email and CV are always asked. Anything here is asked as well.
        </p>
      </Zone>
      <Zone>
        {rows.length === 0 ? (
          <Empty title="No extra questions." hint="Keep it short — every question costs you applicants." />
        ) : (
          <div className="space-y-3">
            {rows.map((row, index) => (
              <div key={index} className="rounded-lg border border-border p-3">
                <div className="flex items-start gap-2">
                  <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_10rem]">
                    <Input
                      value={row.prompt}
                      placeholder="Question, e.g. Do you hold a work permit for Germany?"
                      onChange={(e) => update(index, { prompt: e.target.value })}
                    />
                    <Select value={row.type} onChange={(e) => update(index, { type: e.target.value })}>
                      <option value="text">Short text</option>
                      <option value="textarea">Long text</option>
                      <option value="boolean">Yes / no</option>
                      <option value="single_choice">One choice</option>
                      <option value="multi_choice">Several choices</option>
                      <option value="number">Number</option>
                      <option value="url">Link</option>
                      <option value="date">Date</option>
                    </Select>
                  </div>
                  <Button variant="ghost" onClick={() => setRows((c) => c.filter((_, i) => i !== index))} title="Remove">
                    <Trash2 className="size-4" />
                  </Button>
                </div>

                {choice(row.type) ? (
                  <Textarea
                    value={row.options}
                    placeholder="One option per line"
                    onChange={(e) => update(index, { options: e.target.value })}
                    className="mt-2 min-h-16"
                  />
                ) : null}

                <div className="mt-2 flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-[0.8125rem] text-muted">
                    <input type="checkbox" checked={row.required} onChange={(e) => update(index, { required: e.target.checked })} />
                    Required
                  </label>
                  <label className="flex items-center gap-2 text-[0.8125rem] text-muted">
                    Flag if the answer is
                    <Input
                      value={row.knockout_value}
                      onChange={(e) => update(index, { knockout_value: e.target.value })}
                      placeholder="e.g. No"
                      className="h-7 w-24"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="mt-3 text-xs text-muted">
          A flagged answer marks the application for a human to look at. It never rejects anyone automatically.
        </p>

        <div className="mt-3 flex items-center gap-2">
          <Button
            onClick={() =>
              setRows((c) => [...c, { prompt: "", type: "text", options: "", required: false, knockout_value: "" }])
            }
          >
            <Plus className="size-4" />
            Add question
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save form"}
          </Button>
        </div>
      </Zone>
    </Card>
  );
}

// ── Stages ────────────────────────────────────────────────────────────

function Stages({
  job,
  onChange,
  setError,
}: {
  job: Job & { stages: Stage[] };
  onChange: () => Promise<void>;
  setError: (message: string) => void;
}) {
  const [adding, setAdding] = useState(false);

  async function rename(stage: Stage, name: string) {
    if (!name || name === stage.name) return;
    await api.updateStage(stage.id, { name });
    await onChange();
  }

  async function setSla(stage: Stage, days: number) {
    await api.updateStage(stage.id, { sla_days: days });
    await onChange();
  }

  async function remove(stage: Stage) {
    try {
      const result = await api.deleteStage(stage.id);
      if (result.moved) setError(`${result.moved} candidate(s) moved back a stage.`);
      await onChange();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Card>
      <Zone>
        <Eyebrow right={`${job.stages.length} stages`}>Pipeline</Eyebrow>
        <p className="mt-2 max-w-2xl text-[0.8125rem] text-muted">
          The first stages and the last are fixed — applying, sourcing and hiring are defined in terms of them. A stage
          limit flags anyone who has been sitting there too long, which is how a forgotten candidate becomes a visible one.
        </p>
      </Zone>
      <Zone>
        <ul className="space-y-2">
          {job.stages.map((stage) => (
            <li key={stage.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2.5">
              <span className="size-2 shrink-0 rounded-full" style={{ background: stage.color || "var(--faint)" }} aria-hidden="true" />
              <Input
                defaultValue={stage.name}
                onBlur={(e) => void rename(stage, e.target.value)}
                aria-label={`Name of the ${stage.name} stage`}
                className="h-8 w-48"
              />
              {stage.kind !== "custom" ? <Chip>{stage.kind}</Chip> : null}
              <label className="ml-auto flex items-center gap-2 text-[0.8125rem] text-muted">
                Flag after
                <Input
                  type="number"
                  min={0}
                  defaultValue={stage.sla_days}
                  onBlur={(e) => void setSla(stage, Number(e.target.value) || 0)}
                  aria-label={`Days before flagging in ${stage.name}`}
                  className="h-8 w-16"
                />
                days
              </label>
              <Button
                variant="ghost"
                disabled={stage.kind !== "custom"}
                onClick={() => void remove(stage)}
                title={stage.kind === "custom" ? "Remove this stage" : "Fixed stages cannot be removed"}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            Add stage
          </Button>
        </div>
      </Zone>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a stage">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = String(new FormData(e.currentTarget).get("name") ?? "");
            void api.addStage(job.id, { name }).then(() => {
              setAdding(false);
              void onChange();
            });
          }}
        >
          <div className="p-5">
            <Field label="Stage name" hint="It lands just before the final stage.">
              <Input name="name" required placeholder="e.g. Take-home task" />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button type="submit" variant="primary">
              Add stage
            </Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

// ── Promote ───────────────────────────────────────────────────────────

function Promote({ job }: { job: Job }) {
  const url = `${window.location.origin}/careers/${job.slug}`;
  const feed = `${window.location.origin}/jobs.xml`;
  const widget = `<script src="${window.location.origin}/widget.js" async></script>`;
  const missing = [
    !job.location_country && "a two-letter country code",
    !job.description_md && "a description",
    job.status !== "published" && "publishing",
  ].filter(Boolean) as string[];

  return (
    <Card>
      <Zone>
        <Eyebrow>Where this job appears</Eyebrow>
        <p className="mt-2 max-w-2xl text-[0.8125rem] text-muted">
          Every published job carries machine-readable structured data and appears in the feed below. That is what gets a
          posting into job search results without an ad budget — no board contract, no per-post fee.
        </p>
      </Zone>

      {missing.length ? (
        <Zone>
          <div className="rounded-lg border border-border bg-warning-tint p-3 text-[0.8125rem] text-warning">
            This posting is missing {missing.join(", ")}. Until then it will not be picked up.
          </div>
        </Zone>
      ) : null}

      <Zone>
        <Eyebrow>Links</Eyebrow>
        <dl className="mt-3 space-y-3 text-[0.8125rem]">
          <div>
            <dt className="text-xs font-semibold text-muted">Public posting</dt>
            <dd>
              <a className="link break-all" href={url} target="_blank" rel="noopener">
                {url}
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-muted">Job feed — give this URL to any board that accepts one</dt>
            <dd>
              <a className="link break-all" href={feed} target="_blank" rel="noopener">
                {feed}
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-muted">Embed your openings on your own site</dt>
            <dd>
              <code className="mt-1 block rounded-sm border border-border bg-sunken p-2 text-[0.75rem] break-all">{widget}</code>
            </dd>
          </div>
        </dl>
      </Zone>
    </Card>
  );
}
