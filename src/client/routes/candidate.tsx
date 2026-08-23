import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { AlertTriangle, Check, FileText, Minus, ScanSearch, ShieldAlert, ThumbsDown, ThumbsUp, Trash2, Upload, X } from "lucide-react";
import {
  api,
  type Application,
  type Attachment,
  type Candidate,
  type Criterion,
  type Evaluation,
  type Message,
  type Note,
  type ScreeningResult,
  type Stage,
} from "../api";
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

type Tab = "overview" | "files" | "notes" | "evaluations" | "messages" | "activity";

type FullApplication = Awaited<ReturnType<typeof api.application>>;
type FullCandidate = Awaited<ReturnType<typeof api.candidate>>;

export default function CandidatePage() {
  const { id = "" } = useParams();
  const isApplication = useLocation().pathname.startsWith("/applications/");
  const [tab, setTab] = useState<Tab>("overview");
  const [application, setApplication] = useState<FullApplication | null>(null);
  const [candidate, setCandidate] = useState<FullCandidate | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      if (isApplication) {
        const next = await api.application(id);
        setApplication(next);
        setCandidate(await api.candidate(next.candidate_id));
      } else {
        const next = await api.candidate(id);
        setCandidate(next);
        // A candidate opened on their own still has a pipeline somewhere; show
        // the most recent one so screening and stage controls are reachable.
        const latest = next.applications[0];
        setApplication(latest ? await api.application(latest.id) : null);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id, isApplication]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!candidate) {
    return (
      <>
        <Toolbar title="Candidate" />
        <div className="p-6">{error ? <p className="text-sm text-danger">{error}</p> : null}</div>
      </>
    );
  }

  return (
    <>
      <Toolbar
        title={
          <span className="flex items-center gap-2">
            <Avatar name={candidate.name} />
            {candidate.name}
          </span>
        }
        subtitle={[candidate.headline, application?.job?.title].filter(Boolean).join(" · ")}
      >
        {application ? <StageControl application={application} onChange={load} setError={setError} /> : null}
      </Toolbar>

      <div className="p-6">
        {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}
        {notice ? (
          <div className="mb-4 whitespace-pre-wrap rounded-lg border border-border bg-sunken p-4 text-[0.8125rem] text-muted">
            {notice}
          </div>
        ) : null}
        {application?.flagged_reason ? (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-warning-tint p-3 text-[0.8125rem] text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={2.5} />
            <span>{application.flagged_reason} — a person should decide, not the form.</span>
          </div>
        ) : null}
        {application?.status === "disqualified" ? (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-sunken p-3 text-[0.8125rem] text-muted">
            <span>Disqualified — {application.disqualify_reason}.</span>
            <Button
              onClick={() =>
                void api
                  .restore(application.id)
                  .then(load)
                  .catch((err) => setError((err as Error).message))
              }
            >
              Put back in the pipeline
            </Button>
          </div>
        ) : null}

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "overview", label: "Overview" },
              { value: "files", label: `Files (${candidate.attachments.length})` },
              { value: "notes", label: "Notes" },
              { value: "evaluations", label: "Evaluations" },
              { value: "messages", label: "Messages" },
              { value: "activity", label: "Activity" },
            ]}
          />
          {application ? (
            <Button
              onClick={() =>
                void api
                  .screenOne(application.id)
                  .then((result) =>
                    setNotice(
                      result.dispatched
                        ? "Handed to your agent. Verdicts appear on the overview as it reads."
                        : `${result.error ?? "Your agent could not be reached."}\n\n${result.brief}`,
                    ),
                  )
                  .catch((err) => setError((err as Error).message))
              }
            >
              <ScanSearch className="size-4" />
              Screen
            </Button>
          ) : null}
        </div>

        {tab === "overview" ? (
          <Overview candidate={candidate} application={application} onChange={load} setError={setError} />
        ) : null}
        {tab === "files" ? <Files candidate={candidate} onChange={load} /> : null}
        {tab === "notes" ? <Notes candidate={candidate} applicationId={application?.id} /> : null}
        {tab === "evaluations" ? <Evaluations application={application} /> : null}
        {tab === "messages" ? <Messages application={application} /> : null}
        {tab === "activity" ? <ActivityTab candidateId={candidate.id} /> : null}
      </div>
    </>
  );
}

// ── Stage control ─────────────────────────────────────────────────────

function StageControl({
  application,
  onChange,
  setError,
}: {
  application: FullApplication;
  onChange: () => Promise<void>;
  setError: (message: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reasons, setReasons] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    api.disqualifyReasons().then((r) => setReasons(r.reasons)).catch(() => setReasons([]));
  }, []);

  const stages: Stage[] = application.stages ?? [];

  return (
    <>
      <Select
        aria-label="Stage"
        value={application.stage_id ?? ""}
        disabled={application.status === "disqualified"}
        onChange={(e) =>
          void api
            .moveStage(application.id, e.target.value)
            .then(onChange)
            .catch((err) => setError((err as Error).message))
        }
        className="w-40"
      >
        {stages.map((stage) => (
          <option key={stage.id} value={stage.id}>
            {stage.name}
          </option>
        ))}
      </Select>
      {application.status !== "disqualified" ? (
        <Button variant="danger" onClick={() => setRejecting(true)}>
          Disqualify
        </Button>
      ) : null}

      <Modal open={rejecting} onClose={() => setRejecting(false)} title="Disqualify this candidate">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            void api
              .disqualify(application.id, String(data.get("reason") ?? ""), String(data.get("note") ?? ""))
              .then(() => {
                setRejecting(false);
                return onChange();
              })
              .catch((err) => setError((err as Error).message));
          }}
        >
          <div className="space-y-3 p-5">
            <Field label="Reason" hint="Recorded against this decision, and it is what the reports are built from.">
              <Select name="reason" required defaultValue="">
                <option value="" disabled>
                  Choose a reason…
                </option>
                {reasons.map((reason) => (
                  <option key={reason.id} value={reason.id}>
                    {reason.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Note">
              <Textarea name="note" placeholder="Anything the next person to open this profile should know." />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <Button onClick={() => setRejecting(false)}>Cancel</Button>
            <Button type="submit" variant="danger">
              Disqualify
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

// ── Overview ──────────────────────────────────────────────────────────

const VERDICT_ICON: Record<string, typeof Check> = { met: Check, not_met: X, unclear: Minus };

function Overview({
  candidate,
  application,
  onChange,
  setError,
}: {
  candidate: FullCandidate;
  application: FullApplication | null;
  onChange: () => Promise<void>;
  setError: (message: string) => void;
}) {
  const [screening, setScreening] = useState<{ results: ScreeningResult[]; score: number | null; met: number; total: number } | null>(
    null,
  );
  const [fields, setFields] = useState<{ field_id: string; label: string; type: string; options: string; value: string }[]>([]);

  useEffect(() => {
    if (application) api.screening(application.id).then(setScreening).catch(() => setScreening(null));
    api.candidateFields(candidate.id).then((r) => setFields(r.values)).catch(() => setFields([]));
  }, [application, candidate.id]);

  const links: { label: string; url: string }[] = (() => {
    try {
      return JSON.parse(candidate.links_json || "[]");
    } catch {
      return [];
    }
  })();

  const criteria: Criterion[] = application?.criteria ?? [];
  const byCriterion = new Map((screening?.results ?? []).map((r) => [r.criterion_id, r]));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <Zone>
            <Eyebrow
              right={
                screening?.score != null ? `${screening.met}/${screening.total} must-haves verified` : undefined
              }
            >
              Screening
            </Eyebrow>
            {criteria.length === 0 ? (
              <p className="mt-3 text-sm text-muted">
                This job has no requirements yet.{" "}
                {application ? (
                  <Link className="link" to={`/jobs/${application.job_id}`}>
                    Add them
                  </Link>
                ) : null}{" "}
                and a screening grid appears here.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {criteria.map((criterion) => {
                  const result = byCriterion.get(criterion.id);
                  const rejected = result?.status === "rejected";
                  // An unverified claim never wears a tick, not even a grey one.
                  // The glyph is the fastest-read thing on the row, and a check
                  // beside "Kubernetes" is read as "has Kubernetes" long before
                  // anyone reaches the explanation underneath it.
                  const Icon = rejected ? ShieldAlert : result ? (VERDICT_ICON[result.verdict] ?? Minus) : Minus;
                  return (
                    <div key={criterion.id} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Icon
                          className={`size-4 shrink-0 ${
                            rejected
                              ? "text-danger"
                              : !result
                                ? "text-faint"
                                : result.verdict === "met"
                                  ? "text-success"
                                  : result.verdict === "not_met"
                                    ? "text-danger"
                                    : "text-muted"
                          }`}
                          strokeWidth={2.5}
                        />
                        <span className="text-[0.8125rem] font-medium">{criterion.label}</span>
                        {criterion.weight === "must_have" ? <Chip>must have</Chip> : null}
                        {result?.value && !rejected ? (
                          <span className="data text-[0.8125rem] text-muted">{result.value}</span>
                        ) : null}
                        {rejected ? <Badge tone="danger">unverified</Badge> : null}
                        <span className="ml-auto text-[0.6875rem] text-faint">
                          {result ? (result.assessed_by === "agent" ? "screened by agent" : result.assessor || "by hand") : "not screened"}
                        </span>
                      </div>

                      {criterion.detail ? (
                        <p className="mt-1 pl-6 text-[0.6875rem] text-faint">{criterion.detail}</p>
                      ) : null}

                      {result?.evidence_quote && !rejected ? (
                        <blockquote className="mt-2 border-l-2 border-border pl-3 text-[0.8125rem] text-muted">
                          &ldquo;{result.evidence_quote}&rdquo;
                          <span className="ml-1 text-[0.6875rem] text-faint">
                            — {result.attachment_name ?? "CV"}
                            {result.page_no ? `, p${result.page_no}` : ""}
                          </span>
                        </blockquote>
                      ) : null}

                      {rejected ? (
                        // The whole point of the app, made visible: an
                        // unverifiable claim is shown as unverified, never as
                        // a qualification, and it counts for nothing.
                        <div className="mt-2 rounded-sm border border-border bg-danger-tint p-2 text-[0.75rem] text-danger">
                          <strong>Unverified.</strong> {result?.rejected_reason}
                          {result?.evidence_quote ? (
                            <div className="mt-1 text-muted">Claimed: &ldquo;{result.evidence_quote}&rdquo;</div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </Zone>
        </Card>

        {application && application.answers.length ? (
          <Card>
            <Zone>
              <Eyebrow>Application answers</Eyebrow>
              <dl className="mt-3 space-y-3">
                {application.answers.map((answer) => {
                  const flagged =
                    answer.knockout_value &&
                    answer.value.trim().toLowerCase() === answer.knockout_value.trim().toLowerCase();
                  return (
                    <div key={answer.question_id}>
                      <dt className="text-xs font-semibold text-muted">{answer.prompt}</dt>
                      <dd className="text-[0.8125rem]">
                        {answer.value || <span className="text-faint">No answer</span>}
                        {flagged ? (
                          <Badge tone="warning">
                            <AlertTriangle className="size-3" strokeWidth={2.5} />
                            flagged
                          </Badge>
                        ) : null}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </Zone>
          </Card>
        ) : null}
      </div>

      <div className="space-y-4">
        <Card>
          <Zone>
            <Eyebrow>Contact</Eyebrow>
            <dl className="mt-3 space-y-2 text-[0.8125rem]">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Email</dt>
                <dd className="truncate">{candidate.email || "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Phone</dt>
                <dd>{candidate.phone || "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Location</dt>
                <dd>{candidate.location || "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Source</dt>
                <dd>{candidate.source.replace(/_/g, " ")}</dd>
              </div>
            </dl>
            {links.length ? (
              <ul className="mt-2 space-y-1 text-[0.8125rem]">
                {links.map((link) => (
                  <li key={link.url}>
                    <a className="link" href={link.url} target="_blank" rel="noopener">
                      {link.label || link.url}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </Zone>

          <Zone>
            <Eyebrow>Consent</Eyebrow>
            <p className="mt-2 text-[0.8125rem]">
              {candidate.consent_status === "given" ? (
                <Badge tone="success">Given{candidate.consent_at ? ` · ${candidate.consent_at.slice(0, 10)}` : ""}</Badge>
              ) : candidate.consent_status === "withdrawn" ? (
                <Badge tone="danger">Withdrawn</Badge>
              ) : (
                <Badge tone="warning">Not recorded</Badge>
              )}
            </p>
            {candidate.retain_until ? (
              <p className="mt-2 text-[0.6875rem] text-muted">Kept until {candidate.retain_until}.</p>
            ) : (
              <p className="mt-2 text-[0.6875rem] text-muted">In an active process — no deletion date.</p>
            )}
          </Zone>

          <Zone>
            <Eyebrow>Tags</Eyebrow>
            <TagEditor candidate={candidate} onChange={onChange} setError={setError} />
          </Zone>

          {fields.length ? (
            <Zone>
              <Eyebrow>Profile</Eyebrow>
              <ProfileFields candidateId={candidate.id} values={fields} onSaved={setFields} />
            </Zone>
          ) : null}
        </Card>

        {candidate.applications.length > 1 ? (
          <Card>
            <Zone>
              <Eyebrow right={`${candidate.applications.length}`}>Also applied to</Eyebrow>
              <ul className="mt-2 space-y-1.5 text-[0.8125rem]">
                {candidate.applications.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2">
                    <Link className="link truncate" to={`/applications/${a.id}`}>
                      {a.job_title}
                    </Link>
                    <span className="shrink-0 text-[0.6875rem] text-muted">{a.stage_name ?? a.status}</span>
                  </li>
                ))}
              </ul>
            </Zone>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function TagEditor({
  candidate,
  onChange,
  setError,
}: {
  candidate: Candidate;
  onChange: () => Promise<void>;
  setError: (message: string) => void;
}) {
  const [value, setValue] = useState("");
  const tags = candidate.tags ?? [];

  async function save(next: string[]) {
    try {
      await api.updateCandidate(candidate.id, { tags: next });
      await onChange();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-1">
        {tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1">
            <Pill>{tag}</Pill>
            <button
              type="button"
              onClick={() => void save(tags.filter((t) => t !== tag))}
              aria-label={`Remove the ${tag} tag`}
              className="text-faint hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {tags.length === 0 ? <span className="text-[0.8125rem] text-faint">None</span> : null}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim()) return;
          void save([...tags, value.trim()]);
          setValue("");
        }}
      >
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Add a tag" className="h-8" />
        <Button type="submit">Add</Button>
      </form>
    </>
  );
}

function ProfileFields({
  candidateId,
  values,
  onSaved,
}: {
  candidateId: string;
  values: { field_id: string; label: string; type: string; options: string; value: string }[];
  onSaved: (values: { field_id: string; label: string; type: string; options: string; value: string }[]) => void;
}) {
  const [draft, setDraft] = useState(values);
  useEffect(() => setDraft(values), [values]);

  async function save() {
    await api.putCandidateFields(candidateId, draft.map((d) => ({ field_id: d.field_id, value: d.value })));
    onSaved(draft);
  }

  return (
    <div className="mt-2 space-y-2">
      {draft.map((field, index) => (
        <Field key={field.field_id} label={field.label}>
          {field.type === "textarea" ? (
            <Textarea
              value={field.value}
              onChange={(e) =>
                setDraft((c) => c.map((d, i) => (i === index ? { ...d, value: e.target.value } : d)))
              }
              className="min-h-16"
            />
          ) : field.type === "boolean" ? (
            <Select
              value={field.value}
              onChange={(e) => setDraft((c) => c.map((d, i) => (i === index ? { ...d, value: e.target.value } : d)))}
            >
              <option value="">—</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </Select>
          ) : field.type === "single_choice" || field.type === "multi_choice" ? (
            <Select
              value={field.value}
              onChange={(e) => setDraft((c) => c.map((d, i) => (i === index ? { ...d, value: e.target.value } : d)))}
            >
              <option value="">—</option>
              {field.options
                .split("\n")
                .map((o) => o.trim())
                .filter(Boolean)
                .map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
            </Select>
          ) : (
            <Input
              type={field.type === "number" || field.type === "salary" ? "number" : field.type === "date" ? "date" : "text"}
              value={field.value}
              onChange={(e) => setDraft((c) => c.map((d, i) => (i === index ? { ...d, value: e.target.value } : d)))}
            />
          )}
        </Field>
      ))}
      <Button onClick={() => void save()}>Save profile</Button>
    </div>
  );
}

// ── Files ─────────────────────────────────────────────────────────────

function Files({ candidate, onChange }: { candidate: FullCandidate; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const attachment = await api.uploadAttachment(candidate.id, file);
      // Stored and read in two calls: the upload returns fast, then the text is
      // extracted, so a large file does not look like a hung page.
      await api.extractAttachment(attachment.id);
      await onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Zone>
        <Eyebrow right={`${candidate.attachments.length}`}>Documents</Eyebrow>
        {candidate.attachments.length === 0 ? (
          <Empty title="No files." hint="A CV is what screening evidence is checked against." />
        ) : (
          <ul className="mt-3 space-y-2">
            {candidate.attachments.map((file: Attachment) => (
              <li key={file.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2.5">
                <FileText className="size-4 shrink-0 text-faint" />
                <a className="link text-[0.8125rem]" href={`/api/attachments/${file.id}/file`} target="_blank" rel="noopener">
                  {file.name}
                </a>
                <Chip>{file.kind.replace(/_/g, " ")}</Chip>
                {file.extract_status === "ready" ? (
                  <Chip>
                    {file.page_count} {file.locator_kind === "page" ? "pages" : "blocks"}
                  </Chip>
                ) : file.extract_status === "failed" ? (
                  <Badge tone="danger">unreadable</Badge>
                ) : (
                  <Badge tone="warning">not read</Badge>
                )}
                {file.extract_error ? <span className="text-[0.6875rem] text-muted">{file.extract_error}</span> : null}
                <div className="ml-auto flex items-center gap-1">
                  {file.extract_status !== "ready" ? (
                    <Button onClick={() => void api.extractAttachment(file.id).then(onChange)}>Read text</Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    title="Delete"
                    onClick={() => void api.deleteAttachment(file.id).then(onChange)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <label className="mt-3 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-sm border border-border bg-surface px-2 text-sm font-medium hover:bg-sunken">
          <Upload className="size-4" />
          {busy ? "Reading…" : "Add a file"}
          <input
            type="file"
            className="hidden"
            accept=".pdf,.docx,.txt,.md"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
          />
        </label>
      </Zone>
    </Card>
  );
}

// ── Notes ─────────────────────────────────────────────────────────────

function Notes({ candidate, applicationId }: { candidate: FullCandidate; applicationId?: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState("team");

  const load = useCallback(() => {
    api.notes(candidate.id).then((r) => setNotes(r.notes)).catch(() => setNotes([]));
  }, [candidate.id]);
  useEffect(load, [load]);

  return (
    <Card>
      <Zone>
        <Eyebrow>Add a note</Eyebrow>
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return;
            void api.addNote(candidate.id, { body, visibility, application_id: applicationId }).then(() => {
              setBody("");
              load();
            });
          }}
        >
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="What should the team know?" />
          <div className="flex items-center gap-2">
            <Select value={visibility} onChange={(e) => setVisibility(e.target.value)} className="w-40">
              <option value="team">Visible to the team</option>
              <option value="private">Only me</option>
            </Select>
            <Button type="submit" variant="primary">
              Save note
            </Button>
          </div>
        </form>
      </Zone>
      <Zone>
        <Eyebrow right={`${notes.length}`}>Notes</Eyebrow>
        {notes.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {notes.map((note) => (
              <li key={note.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <Avatar name={note.author_name || "?"} size={20} />
                  <span className="text-[0.8125rem] font-medium">{note.author_name || "Someone"}</span>
                  {note.visibility === "private" ? <Chip>private</Chip> : null}
                  <span className="ml-auto text-[0.6875rem] text-faint">{note.created_at.slice(0, 16)}</span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-[0.8125rem]">{note.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Zone>
    </Card>
  );
}

// ── Evaluations ───────────────────────────────────────────────────────

const OVERALL: { value: string; label: string; tone: "success" | "danger" | "neutral" }[] = [
  { value: "strong_yes", label: "Strong yes", tone: "success" },
  { value: "yes", label: "Yes", tone: "success" },
  { value: "no", label: "No", tone: "danger" },
  { value: "strong_no", label: "Strong no", tone: "danger" },
];

function Evaluations({ application }: { application: FullApplication | null }) {
  const [data, setData] = useState<{ evaluations: Evaluation[]; hidden: number; mine: boolean } | null>(null);
  const [overall, setOverall] = useState("yes");
  const [summary, setSummary] = useState("");

  const load = useCallback(() => {
    if (application) api.evaluations(application.id).then(setData).catch(() => setData(null));
  }, [application]);
  useEffect(load, [load]);

  if (!application) return <Empty title="No application to evaluate." />;

  return (
    <Card>
      <Zone>
        <Eyebrow>Your evaluation</Eyebrow>
        <form
          className="mt-2 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void api.addEvaluation(application.id, { overall, summary }).then(() => {
              setSummary("");
              load();
            });
          }}
        >
          <div className="flex flex-wrap gap-2">
            {OVERALL.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setOverall(option.value)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-sm border px-2 text-sm transition-colors ${
                  overall === option.value
                    ? "border-foreground bg-sunken font-medium text-foreground"
                    : "border-border text-muted hover:bg-sunken"
                }`}
              >
                {option.tone === "success" ? <ThumbsUp className="size-3.5" /> : <ThumbsDown className="size-3.5" />}
                {option.label}
              </button>
            ))}
          </div>
          <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What did you see?" />
          <Button type="submit" variant="primary">
            Submit evaluation
          </Button>
        </form>
      </Zone>

      <Zone>
        <Eyebrow right={data ? `${data.evaluations.length}` : undefined}>The team</Eyebrow>
        {data?.hidden ? (
          <p className="mt-3 text-sm text-muted">
            {data.hidden} evaluation{data.hidden === 1 ? " is" : "s are"} hidden until you submit yours — so the first
            opinion in the room doesn&rsquo;t become everybody&rsquo;s.
          </p>
        ) : data && data.evaluations.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nobody has evaluated this candidate yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {(data?.evaluations ?? []).map((evaluation) => {
              const option = OVERALL.find((o) => o.value === evaluation.overall);
              return (
                <li key={evaluation.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2">
                    <Avatar name={evaluation.author_name || "?"} size={20} />
                    <span className="text-[0.8125rem] font-medium">{evaluation.author_name || "Someone"}</span>
                    <Badge tone={option?.tone ?? "neutral"}>{option?.label ?? evaluation.overall}</Badge>
                    <span className="ml-auto text-[0.6875rem] text-faint">{evaluation.created_at.slice(0, 10)}</span>
                  </div>
                  {evaluation.summary ? (
                    <p className="mt-1.5 whitespace-pre-wrap text-[0.8125rem]">{evaluation.summary}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Zone>
    </Card>
  );
}

// ── Messages ──────────────────────────────────────────────────────────

function Messages({ application }: { application: FullApplication | null }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [canSend, setCanSend] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    if (!application) return;
    api.messages(application.id).then((r) => setMessages(r.messages)).catch(() => setMessages([]));
    api.messageTemplates().then((r) => setTemplates(r.templates)).catch(() => setTemplates([]));
    api.settings().then((s) => setCanSend(Boolean(s.can_send_email))).catch(() => setCanSend(false));
  }, [application]);
  useEffect(load, [load]);

  if (!application) return <Empty title="No application to write about." />;

  return (
    <Card>
      <Zone>
        <Eyebrow>Write to this candidate</Eyebrow>
        {!canSend ? (
          <p className="mt-2 text-[0.8125rem] text-muted">
            No mail provider is configured, so this records the message and hands it to you to send. Add a provider key in
            your deployment to send from here.
          </p>
        ) : null}
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            void api
              .sendMessage(application.id, { subject, body, log_only: !canSend })
              .then(() => {
                setSubject("");
                setBody("");
                load();
              })
              .catch((err) => setError((err as Error).message));
          }}
        >
          {templates.length ? (
            <Select
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                void api.compose(application.id, e.target.value).then((draft) => {
                  setSubject(draft.subject);
                  setBody(draft.body);
                });
              }}
            >
              <option value="">Start from a template…</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </Select>
          ) : null}
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" required />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message" className="min-h-32" required />
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary">
              {canSend ? "Send" : "Record message"}
            </Button>
            {error ? <span className="text-xs text-danger">{error}</span> : null}
          </div>
        </form>
      </Zone>

      <Zone>
        <Eyebrow right={`${messages.length}`}>History</Eyebrow>
        {messages.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nothing sent yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {messages.map((message) => (
              <li key={message.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.8125rem] font-medium">{message.subject}</span>
                  <Badge tone={message.status === "sent" ? "success" : message.status === "failed" ? "danger" : "neutral"}>
                    {message.status}
                  </Badge>
                  <span className="ml-auto text-[0.6875rem] text-faint">{message.created_at.slice(0, 16)}</span>
                </div>
                {message.error ? <p className="mt-1 text-[0.75rem] text-danger">{message.error}</p> : null}
                <p className="mt-1.5 whitespace-pre-wrap text-[0.8125rem] text-muted">{message.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Zone>
    </Card>
  );
}

// ── Activity ──────────────────────────────────────────────────────────

function ActivityTab({ candidateId }: { candidateId: string }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.activity>>["activity"]>([]);

  useEffect(() => {
    api.activity({ candidate_id: candidateId }).then((r) => setRows(r.activity)).catch(() => setRows([]));
  }, [candidateId]);

  return (
    <Card>
      <Zone>
        <Eyebrow right={`${rows.length}`}>Everything that happened</Eyebrow>
        <p className="mt-2 text-[0.8125rem] text-muted">
          The record of this application: who did what, when, and whether it was a person or the agent. This is the answer
          if the candidate ever asks.
        </p>
        <ul className="mt-3 space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="flex items-start gap-2 border-b border-border pb-2 last:border-b-0">
              <Chip>{row.actor_kind}</Chip>
              <div className="min-w-0 flex-1">
                <p className="text-[0.8125rem]">{row.summary}</p>
                <p className="text-[0.6875rem] text-faint">
                  {row.actor_name || row.actor_kind} · {row.created_at.slice(0, 16)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Zone>
    </Card>
  );
}
