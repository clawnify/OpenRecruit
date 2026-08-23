import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import { api, type MessageTemplate, type ProfileField, type Settings as SettingsData } from "../api";
import {
  Badge,
  Button,
  Card,
  Empty,
  Eyebrow,
  Field,
  Input,
  Modal,
  Segmented,
  Select,
  Textarea,
  Toolbar,
  Zone,
} from "../components/ui";

type Tab = "careers" | "hiring" | "fields" | "templates" | "data" | "agent";

export default function Settings() {
  const [tab, setTab] = useState<Tab>("careers");
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setSettings(await api.settings());
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <Toolbar title="Settings" subtitle="Your careers site, how you hire, and what you keep" />

      <div className="p-6">
        {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}

        <div className="mb-4">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "careers", label: "Careers site" },
              { value: "hiring", label: "Hiring" },
              { value: "fields", label: "Profile fields" },
              { value: "templates", label: "Messages" },
              { value: "data", label: "Data & retention" },
              { value: "agent", label: "Agent" },
            ]}
          />
        </div>

        {settings && tab === "careers" ? <Careers settings={settings} onSaved={load} /> : null}
        {settings && tab === "hiring" ? <Hiring settings={settings} onSaved={load} /> : null}
        {tab === "fields" ? <Fields /> : null}
        {tab === "templates" ? <Templates /> : null}
        {settings && tab === "data" ? <Data settings={settings} onSaved={load} /> : null}
        {tab === "agent" ? <AgentSettings /> : null}
      </div>
    </>
  );
}

// ── Careers site ──────────────────────────────────────────────────────

function Careers({ settings, onSaved }: { settings: SettingsData; onSaved: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(form: HTMLFormElement) {
    const data = new FormData(form);
    setSaving(true);
    try {
      await api.updateSettings({
        company_name: String(data.get("company_name") ?? ""),
        company_url: String(data.get("company_url") ?? ""),
        careers_url: String(data.get("careers_url") ?? ""),
        tagline: String(data.get("tagline") ?? ""),
        intro_md: String(data.get("intro_md") ?? ""),
        accent: String(data.get("accent") ?? ""),
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
      <Card>
        <Zone>
          <Eyebrow>Your careers site</Eyebrow>
          <p className="mt-2 max-w-2xl text-[0.8125rem] text-muted">
            Live at{" "}
            <a className="link" href="/careers" target="_blank" rel="noopener">
              /careers
            </a>
            . Every published job gets its own page there, with the structured data that puts it into job search results.
          </p>
        </Zone>

        <Zone>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Company name">
              <Input name="company_name" defaultValue={settings.company_name} required />
            </Field>
            <Field label="Company website">
              <Input name="company_url" defaultValue={settings.company_url} placeholder="https://…" />
            </Field>
            <Field
              label="Public address of this careers site"
              hint="Needed so structured data and the job feed carry the right absolute URLs."
            >
              <Input name="careers_url" defaultValue={settings.careers_url} placeholder="https://careers.example.com" />
            </Field>
            <Field label="Accent colour">
              <Input name="accent" defaultValue={settings.accent} placeholder="#dd5164" />
            </Field>
          </div>
          <div className="mt-3 space-y-3">
            <Field label="Headline">
              <Input name="tagline" defaultValue={settings.tagline} placeholder="e.g. Build the thing people actually use" />
            </Field>
            <Field label="Introduction" hint="Markdown. Shown above the list of openings.">
              <Textarea name="intro_md" defaultValue={settings.intro_md} className="min-h-24" />
            </Field>
          </div>
        </Zone>

        <Zone>
          <Eyebrow>Logo</Eyebrow>
          <div className="mt-2 flex items-center gap-3">
            {settings.logo_key ? (
              <img src="/api/careers/logo" alt="" className="h-8 w-auto rounded-sm border border-border" />
            ) : (
              <span className="text-[0.8125rem] text-faint">None yet</span>
            )}
            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-sm border border-border bg-surface px-2 text-sm font-medium hover:bg-sunken">
              <Upload className="size-4" />
              Upload
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void api.uploadImage("logo", file).then(onSaved);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </Zone>
      </Card>

      <div className="mt-4 flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {saved ? <span className="text-xs text-success">Saved</span> : null}
      </div>
    </form>
  );
}

// ── Hiring policy ─────────────────────────────────────────────────────

function Hiring({ settings, onSaved }: { settings: SettingsData; onSaved: () => Promise<void> }) {
  const [blind, setBlind] = useState(settings.blind_until_position);
  const [hide, setHide] = useState(settings.hide_evaluations === 1);
  const [saved, setSaved] = useState(false);

  async function save() {
    await api.updateSettings({ blind_until_position: blind, hide_evaluations: hide });
    await onSaved();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <Card>
      <Zone>
        <Eyebrow>Fairer by default</Eyebrow>
        <p className="mt-2 max-w-2xl text-[0.8125rem] text-muted">
          Two settings that cost nothing and change what your team sees before it forms an opinion.
        </p>
      </Zone>

      <Zone>
        <Field
          label="Hide candidate names in the early stages"
          hint="Names, emails and headlines are replaced with a handle until a candidate reaches this position in the pipeline. 0 turns it off."
        >
          <Input type="number" min={0} max={10} value={blind} onChange={(e) => setBlind(Number(e.target.value) || 0)} className="w-24" />
        </Field>
      </Zone>

      <Zone>
        <label className="flex items-start gap-2.5">
          <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} className="mt-1" />
          <span>
            <span className="block text-[0.8125rem] font-medium">Hide colleagues&rsquo; evaluations until you submit yours</span>
            <span className="mt-0.5 block text-[0.6875rem] text-muted">
              The first opinion in the room otherwise becomes everybody&rsquo;s, and four agreeing scorecards then read as
              four independent judgements.
            </span>
          </span>
        </label>
      </Zone>

      <Zone>
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={() => void save()}>
            Save
          </Button>
          {saved ? <span className="text-xs text-success">Saved</span> : null}
        </div>
      </Zone>
    </Card>
  );
}

// ── Profile fields ────────────────────────────────────────────────────

function Fields() {
  const [rows, setRows] = useState<(ProfileField & { isNew?: boolean })[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.profileFields().then((r) => setRows(r.fields)).catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);

  const choice = (type: string) => type === "single_choice" || type === "multi_choice";

  return (
    <Card>
      <Zone>
        <Eyebrow>Fields on every candidate</Eyebrow>
        <p className="mt-2 max-w-2xl text-[0.8125rem] text-muted">
          What your team tracks that no schema could have guessed — notice period, day rate, languages. There is
          deliberately no field for gender, nationality or age: diversity monitoring is a separate, anonymised exercise,
          and a box for it next to &ldquo;notice period&rdquo; is data that will end up informing a decision it must not.
        </p>
      </Zone>

      <Zone>
        {rows.length === 0 ? (
          <Empty title="No custom fields." hint="Most teams need two or three. Start there." />
        ) : (
          <ul className="space-y-2">
            {rows.map((row, index) => (
              <li key={row.id || index} className="rounded-lg border border-border p-2.5">
                <div className="flex items-start gap-2">
                  <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_11rem]">
                    <Input
                      value={row.label}
                      placeholder="Field name, e.g. Notice period"
                      onChange={(e) =>
                        setRows((c) => c.map((r, i) => (i === index ? { ...r, label: e.target.value } : r)))
                      }
                    />
                    <Select
                      value={row.type}
                      onChange={(e) => setRows((c) => c.map((r, i) => (i === index ? { ...r, type: e.target.value } : r)))}
                    >
                      <option value="text">Short text</option>
                      <option value="textarea">Long text</option>
                      <option value="boolean">Yes / no</option>
                      <option value="single_choice">One choice</option>
                      <option value="multi_choice">Several choices</option>
                      <option value="number">Number</option>
                      <option value="salary">Salary</option>
                      <option value="date">Date</option>
                      <option value="address">Address</option>
                      <option value="languages">Languages</option>
                      <option value="skills">Skills</option>
                      <option value="url">Link</option>
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
                    onChange={(e) => setRows((c) => c.map((r, i) => (i === index ? { ...r, options: e.target.value } : r)))}
                    className="mt-2 min-h-16"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex items-center gap-2">
          <Button
            onClick={() =>
              setRows((c) => [...c, { id: "", position: c.length, label: "", type: "text", options: "", isNew: true }])
            }
          >
            <Plus className="size-4" />
            Add field
          </Button>
          <Button
            variant="primary"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              void api
                .putProfileFields(
                  rows
                    .filter((r) => r.label.trim())
                    .map((r) => ({ ...(r.id ? { id: r.id } : {}), label: r.label, type: r.type, options: r.options })),
                )
                .then((r) => setRows(r.fields))
                .finally(() => setSaving(false));
            }}
          >
            {saving ? "Saving…" : "Save fields"}
          </Button>
        </div>
      </Zone>
    </Card>
  );
}

// ── Message templates ─────────────────────────────────────────────────

function Templates() {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [editing, setEditing] = useState<MessageTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api.messageTemplates().then((r) => setTemplates(r.templates)).catch(() => setTemplates([]));
  }, []);
  useEffect(load, [load]);

  const active = editing ?? (creating ? ({ id: "", name: "", subject: "", body: "", stage_kind: "" } as MessageTemplate) : null);

  return (
    <Card>
      <Zone>
        <Eyebrow right={`${templates.length}`}>Message templates</Eyebrow>
        <p className="mt-2 max-w-2xl text-[0.8125rem] text-muted">
          Placeholders: <code>{"{{candidate_name}}"}</code>, <code>{"{{first_name}}"}</code>, <code>{"{{job_title}}"}</code>,{" "}
          <code>{"{{company_name}}"}</code>, <code>{"{{stage_name}}"}</code>. A template is never sent on its own — a person
          always presses send.
        </p>
      </Zone>

      <Zone>
        {templates.length === 0 ? (
          <Empty
            title="No templates yet."
            hint="The rejection you never get round to writing is the one that never gets sent."
          />
        ) : (
          <ul className="space-y-2">
            {templates.map((template) => (
              <li key={template.id} className="flex items-center gap-2 rounded-lg border border-border p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[0.8125rem] font-medium">{template.name}</p>
                  <p className="truncate text-[0.6875rem] text-muted">{template.subject || "No subject"}</p>
                </div>
                <Button onClick={() => setEditing(template)}>Edit</Button>
                <Button
                  variant="ghost"
                  title="Delete"
                  onClick={() => void api.deleteMessageTemplate(template.id).then(load)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New template
          </Button>
        </div>
      </Zone>

      <Modal
        open={Boolean(active)}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        title={editing ? "Edit template" : "New template"}
        wide
      >
        {active ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const body = {
                name: String(data.get("name") ?? ""),
                subject: String(data.get("subject") ?? ""),
                body: String(data.get("body") ?? ""),
              };
              const done = () => {
                setEditing(null);
                setCreating(false);
                load();
              };
              void (active.id ? api.updateMessageTemplate(active.id, body) : api.saveMessageTemplate(body)).then(done);
            }}
          >
            <div className="space-y-3 p-5">
              <Field label="Template name">
                <Input name="name" defaultValue={active.name} required placeholder="e.g. Interview invitation" />
              </Field>
              <Field label="Subject">
                <Input name="subject" defaultValue={active.subject} placeholder="About your application for {{job_title}}" />
              </Field>
              <Field label="Message">
                <Textarea name="body" defaultValue={active.body} className="min-h-48" />
              </Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <Button
                onClick={() => {
                  setEditing(null);
                  setCreating(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Save template
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </Card>
  );
}

// ── Data & retention ──────────────────────────────────────────────────

function Data({ settings, onSaved }: { settings: SettingsData; onSaved: () => Promise<void> }) {
  const [retention, setRetention] = useState<Awaited<ReturnType<typeof api.retention>> | null>(null);
  const [days, setDays] = useState(settings.retention_days);
  const [consent, setConsent] = useState(settings.consent_text);
  const [privacy, setPrivacy] = useState(settings.privacy_url);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState("");

  const load = useCallback(() => {
    api.retention().then(setRetention).catch(() => setRetention(null));
  }, []);
  useEffect(load, [load]);

  return (
    <Card>
      <Zone>
        <Eyebrow>What applicants agree to</Eyebrow>
        <div className="mt-3 space-y-3">
          <Field label="Consent notice" hint="Shown beside the apply button and stored verbatim on every application.">
            <Textarea value={consent} onChange={(e) => setConsent(e.target.value)} className="min-h-20" />
          </Field>
          <Field label="Link to your privacy notice">
            <Input value={privacy} onChange={(e) => setPrivacy(e.target.value)} placeholder="https://…" />
          </Field>
        </div>
      </Zone>

      <Zone>
        <Eyebrow>How long you keep applications</Eyebrow>
        <p className="mt-2 max-w-2xl text-[0.8125rem] text-muted">
          The clock starts when someone&rsquo;s last application closes — nobody in an active process has a deletion date.
          Six months is a common default in the EU, but the right number depends on where you hire.
        </p>
        <div className="mt-3 flex items-end gap-3">
          <Field label="Days">
            <Input type="number" min={0} value={days} onChange={(e) => setDays(Number(e.target.value) || 0)} className="w-28" />
          </Field>
          <Button
            variant="primary"
            onClick={() =>
              void api
                .updateSettings({ retention_days: days, consent_text: consent, privacy_url: privacy })
                .then(onSaved)
                .then(load)
            }
          >
            Save
          </Button>
        </div>
      </Zone>

      <Zone>
        <Eyebrow right={retention ? `${retention.upcoming_count} due within 30 days` : undefined}>Due for erasure</Eyebrow>
        {retention && retention.due_count === 0 ? (
          <p className="mt-3 text-sm text-muted">Nobody is past their retention period.</p>
        ) : (
          <>
            <p className="mt-3 text-[0.8125rem]">
              <Badge tone="warning">{retention?.due_count ?? 0} candidate records</Badge> are past the period you set.
            </p>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-[0.8125rem] text-muted">
              {(retention?.due ?? []).map((row) => (
                <li key={row.id}>
                  {row.name} — kept until {row.retain_until}
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <Button variant="danger" onClick={() => setConfirming(true)}>
                Erase them
              </Button>
            </div>
          </>
        )}
        {result ? <p className="mt-2 text-[0.8125rem] text-success">{result}</p> : null}
      </Zone>

      <Modal open={confirming} onClose={() => setConfirming(false)} title="Erase these records?">
        <div className="space-y-3 p-5 text-[0.8125rem] text-muted">
          <p>
            This deletes {retention?.due_count ?? 0} people&rsquo;s applications, CVs, notes, evaluations and messages.
            There is no undo, and there is not meant to be — a soft delete would not satisfy the reason you are doing it.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() =>
              void api.purge().then((r) => {
                setResult(`Erased ${r.erased} record(s) and ${r.files_deleted} file(s).`);
                setConfirming(false);
                load();
              })
            }
          >
            Erase permanently
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

// ── Agent ─────────────────────────────────────────────────────────────

function AgentSettings() {
  const [state, setState] = useState<Awaited<ReturnType<typeof api.agent>> | null>(null);

  const load = useCallback(() => {
    api.agent().then(setState).catch(() => setState(null));
  }, []);
  useEffect(load, [load]);

  return (
    <Card>
      <Zone>
        <Eyebrow>Who screens candidates</Eyebrow>
        <p className="mt-2 max-w-2xl text-[0.8125rem] text-muted">
          Screening is handed to your agent, which reads each CV and fills the requirements grid. It never moves anyone,
          rejects anyone or writes to anyone — those are refused at the API, not just discouraged.
        </p>
      </Zone>

      <Zone>
        {!state?.available ? (
          <p className="text-[0.8125rem] text-muted">
            This deployment cannot reach an agent. Screening still works — you get the brief to hand over in chat instead.
          </p>
        ) : !state.reachable ? (
          <p className="text-[0.8125rem] text-warning">Configured, but the platform did not answer just now.</p>
        ) : state.servers.length <= 1 ? (
          <p className="text-[0.8125rem] text-muted">
            {state.servers.length === 1
              ? `Screening goes to ${state.servers[0].name ?? "your agent"}.`
              : "No agents found in this organisation yet."}
          </p>
        ) : (
          <Field label="Agent" hint="You have more than one, so it has to be said which one.">
            <Select
              value={state.server_id ?? ""}
              onChange={(e) => void api.setAgentServer(e.target.value).then(load)}
              className="w-72"
            >
              <option value="">Choose an agent…</option>
              {state.servers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.name ?? server.id} {server.status ? `· ${server.status}` : ""}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </Zone>
    </Card>
  );
}
