import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { api, type Candidate, type Job, type TalentPool } from "../api";
import { Avatar, Badge, Button, Empty, Field, Input, Modal, Pill, Select, Toolbar } from "../components/ui";

export default function Candidates() {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [pools, setPools] = useState<TalentPool[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState("");
  const [pool, setPool] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (nextSearch = search, nextPool = pool) => {
      try {
        const { candidates } = await api.candidates({ search: nextSearch, pool_id: nextPool || undefined });
        setCandidates(candidates);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [search, pool],
  );

  useEffect(() => {
    void load("", "");
    api.pools().then((r) => setPools(r.pools)).catch(() => setPools([]));
    api.jobs({ status: "published" }).then((r) => setJobs(r.jobs)).catch(() => setJobs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function add(form: HTMLFormElement) {
    const data = new FormData(form);
    try {
      const created = await api.createCandidate({
        name: String(data.get("name") ?? ""),
        email: String(data.get("email") ?? ""),
        headline: String(data.get("headline") ?? ""),
        source: "sourced",
        source_detail: String(data.get("source_detail") ?? ""),
        job_id: String(data.get("job_id") ?? "") || undefined,
      });
      setAdding(false);
      window.location.href = created.application_id
        ? `/applications/${created.application_id}`
        : `/candidates/${created.id}`;
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <Toolbar title="Candidates" subtitle="Everyone you have ever spoken to">
        <Input
          type="search"
          placeholder="Search by name, email or title…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            void load(e.target.value, pool);
          }}
          className="hidden w-64 sm:block"
        />
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          Add candidate
        </Button>
      </Toolbar>

      <div className="p-6">
        {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="eyebrow">Talent pools</span>
            <Select
              value={pool}
              onChange={(e) => {
                setPool(e.target.value);
                void load(search, e.target.value);
              }}
              className="w-52"
            >
              <option value="">Everyone</option>
              {pools.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.member_count})
                </option>
              ))}
            </Select>
            <PoolCreator onCreated={() => api.pools().then((r) => setPools(r.pools))} />
          </div>
          <span className="data text-[0.6875rem] text-faint">{candidates?.length ?? 0} shown</span>
        </div>

        {candidates && candidates.length === 0 ? (
          <Empty
            title="Nobody here yet."
            hint="Applications from your careers site land here automatically, or add someone you already know."
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Plus className="size-4" />
                Add candidate
              </Button>
            }
          />
        ) : (
          <div className="-mx-6 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-y border-border bg-sunken text-left">
                  {["Name", "Headline", "Source", "Consent", "Tags", "Applications"].map((heading, i) => (
                    <th
                      key={heading}
                      className={`px-3 py-2.5 text-xs font-semibold tracking-[0.04em] text-muted first:pl-6 last:pr-6 ${i === 5 ? "text-right" : ""}`}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(candidates ?? []).map((candidate) => (
                  <tr key={candidate.id} className="border-t border-border hover:bg-sunken">
                    <td className="px-3 py-2.5 first:pl-6">
                      <span className="flex items-center gap-2">
                        <Avatar name={candidate.name} size={24} />
                        <Link to={`/candidates/${candidate.id}`} className="link text-[0.8125rem] font-medium">
                          {candidate.name}
                        </Link>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[0.8125rem] text-muted">{candidate.headline || "—"}</td>
                    <td className="px-3 py-2.5 text-[0.8125rem] text-muted">{candidate.source.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2.5">
                      {candidate.consent_status === "given" ? (
                        <Badge tone="success">given</Badge>
                      ) : candidate.consent_status === "withdrawn" ? (
                        <Badge tone="danger">withdrawn</Badge>
                      ) : (
                        <Badge tone="warning">not recorded</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex flex-wrap gap-1">
                        {(candidate.tags ?? []).slice(0, 3).map((tag) => (
                          <Pill key={tag}>{tag}</Pill>
                        ))}
                      </span>
                    </td>
                    <td className="data px-3 py-2.5 text-right text-[0.8125rem] last:pr-6">
                      {candidate.application_count ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a candidate">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void add(e.currentTarget);
          }}
        >
          <div className="space-y-3 p-5">
            <Field label="Name">
              <Input name="name" required />
            </Field>
            <Field label="Email">
              <Input type="email" name="email" />
            </Field>
            <Field label="Headline">
              <Input name="headline" placeholder="e.g. Senior Backend Engineer at Acme" />
            </Field>
            <Field label="Where did they come from?">
              <Input name="source_detail" placeholder="e.g. referred by Ana, or a conference" />
            </Field>
            <Field label="Add to a job" hint="Optional — they can sit in your pool without a role.">
              <Select name="job_id" defaultValue="">
                <option value="">No job yet</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.title}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-[0.6875rem] text-faint">
              Their consent is recorded as <strong>not given</strong> — they have not seen a notice. Ask before you write
              to them.
            </p>
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button type="submit" variant="primary">
              Add candidate
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function PoolCreator({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Pool
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="New talent pool">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            void api
              .createPool({ name: String(data.get("name") ?? ""), description: String(data.get("description") ?? "") })
              .then(() => {
                setOpen(false);
                onCreated();
              });
          }}
        >
          <div className="space-y-3 p-5">
            <Field label="Pool name">
              <Input name="name" required placeholder="e.g. Berlin frontend, 2026 grads" />
            </Field>
            <Field label="What is it for?">
              <Input name="description" />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary">
              Create pool
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
