import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Plus } from "lucide-react";
import { api, type Job } from "../api";
import { Badge, Button, Empty, Field, Input, Modal, Select, Segmented, Toolbar } from "../components/ui";

const STATUS_TONE: Record<string, "success" | "warning" | "neutral"> = {
  published: "success",
  draft: "warning",
  closed: "neutral",
  archived: "neutral",
};

export default function Jobs() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "published" | "draft" | "closed">("all");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function load(nextSearch = search, nextStatus = status) {
    try {
      const { jobs } = await api.jobs({ search: nextSearch, status: nextStatus === "all" ? undefined : nextStatus });
      setJobs(jobs);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load("", "all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create(form: HTMLFormElement) {
    const data = new FormData(form);
    try {
      const job = await api.createJob({
        title: String(data.get("title") ?? ""),
        department: String(data.get("department") ?? ""),
        workplace: String(data.get("workplace") ?? "onsite"),
        location_city: String(data.get("city") ?? ""),
        location_country: String(data.get("country") ?? ""),
      });
      window.location.href = `/jobs/${job.id}`;
    } catch (err) {
      setError((err as Error).message);
      setCreating(false);
    }
  }

  const published = jobs?.filter((job) => job.status === "published").length ?? 0;

  return (
    <>
      <Toolbar title="Jobs" subtitle="Every role, and who is in its pipeline">
        <Input
          type="search"
          placeholder="Search jobs…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            void load(e.target.value);
          }}
          className="hidden w-56 sm:block"
        />
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          New job
        </Button>
      </Toolbar>

      <div className="p-6">
        {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}

        <div className="mb-3 flex items-center justify-between gap-3">
          <Segmented
            value={status}
            onChange={(next) => {
              setStatus(next);
              void load(search, next);
            }}
            options={[
              { value: "all", label: "All" },
              { value: "published", label: "Published" },
              { value: "draft", label: "Drafts" },
              { value: "closed", label: "Closed" },
            ]}
          />
          <span className="data text-[0.6875rem] text-faint">{published} live on the careers site</span>
        </div>

        {jobs && jobs.length === 0 ? (
          <Empty
            title="No jobs yet."
            hint="A job holds its own pipeline, its requirements and its page on your careers site."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                New job
              </Button>
            }
          />
        ) : (
          // Full-bleed: the header fill and the row hairlines are the table's
          // frame, so -mx-6 cancels the page padding and first:pl-6 puts the
          // text back in line with the furniture above it.
          <div className="-mx-6 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-y border-border bg-sunken text-left">
                  {["Job", "Department", "Location", "Status", "New", "In pipeline", "Hired"].map((heading, i) => (
                    <th
                      key={heading}
                      className={`px-3 py-2.5 text-xs font-semibold tracking-[0.04em] text-muted first:pl-6 last:pr-6 ${i >= 4 ? "text-right" : ""}`}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(jobs ?? []).map((job) => (
                  <tr key={job.id} className="border-t border-border hover:bg-sunken">
                    <td className="px-3 py-2.5 first:pl-6">
                      <Link to={`/jobs/${job.id}`} className="link text-[0.8125rem] font-medium">
                        {job.title}
                      </Link>
                      {job.status === "published" ? (
                        <a
                          href={`/careers/${job.slug}`}
                          target="_blank"
                          rel="noopener"
                          className="ml-1.5 inline-block align-middle text-faint hover:text-foreground"
                          aria-label={`Open the public page for ${job.title}`}
                        >
                          <ExternalLink className="size-3" />
                        </a>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-[0.8125rem] text-muted">{job.department || "—"}</td>
                    <td className="px-3 py-2.5 text-[0.8125rem] text-muted">
                      {job.workplace === "remote"
                        ? "Remote"
                        : [job.location_city, job.location_country].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={STATUS_TONE[job.status] ?? "neutral"}>{job.status}</Badge>
                    </td>
                    <td className="data px-3 py-2.5 text-right text-[0.8125rem]">{job.new_count ?? 0}</td>
                    <td className="data px-3 py-2.5 text-right text-[0.8125rem]">{job.active_count ?? 0}</td>
                    <td className="data px-3 py-2.5 text-right text-[0.8125rem] last:pr-6">{job.hired_count ?? 0}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-sunken">
                  <td className="px-3 py-2 text-xs text-muted first:pl-6" colSpan={4}>
                    Total
                  </td>
                  <td className="data px-3 py-2 text-right text-xs text-muted">
                    {(jobs ?? []).reduce((n, job) => n + (job.new_count ?? 0), 0)}
                  </td>
                  <td className="data px-3 py-2 text-right text-xs text-muted">
                    {(jobs ?? []).reduce((n, job) => n + (job.active_count ?? 0), 0)}
                  </td>
                  <td className="data px-3 py-2 text-right text-xs text-muted last:pr-6">
                    {(jobs ?? []).reduce((n, job) => n + (job.hired_count ?? 0), 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="New job">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create(e.currentTarget);
          }}
        >
          <div className="space-y-3 p-5">
            <Field label="Job title">
              <Input name="title" required placeholder="e.g. Senior Backend Engineer" />
            </Field>
            <Field label="Department">
              <Input name="department" placeholder="e.g. Engineering" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Workplace">
                <Select name="workplace" defaultValue="onsite">
                  <option value="onsite">On site</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="remote">Remote</option>
                </Select>
              </Field>
              <Field label="City">
                <Input name="city" placeholder="e.g. Berlin" />
              </Field>
            </div>
            <Field
              label="Country"
              hint="Two-letter code. Job search engines will not list a posting without one."
            >
              <Input name="country" maxLength={2} placeholder="DE" className="uppercase" />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" variant="primary">
              Create draft
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
