import { useCallback, useEffect, useState } from "react";
import { api, type Job } from "../api";
import { Card, Empty, Eyebrow, Segmented, Select, Stat, Toolbar, Zone } from "../components/ui";

type Report = Awaited<ReturnType<typeof api.reports>>;

/**
 * A horizontal bar. Deliberately not a charting library: three bar lists and a
 * funnel are the whole reporting surface, and a dependency that renders SVG
 * charts would be larger than the rest of the client.
 */
function Bar({ label, value, max, meta }: { label: string; value: number; max: number; meta?: string }) {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <li className="py-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[0.8125rem]">{label}</span>
        <span className="data shrink-0 text-[0.8125rem]">
          {value}
          {meta ? <span className="ml-1.5 text-[0.6875rem] text-muted">{meta}</span> : null}
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-sunken">
        <div className="h-1.5 rounded-full bg-[var(--chart)]" style={{ width: `${width}%` }} />
      </div>
    </li>
  );
}

export default function Reports() {
  const [report, setReport] = useState<Report | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState("");
  const [days, setDays] = useState<"90" | "365" | "1095">("365");
  const [error, setError] = useState("");

  const load = useCallback(async (nextJob = jobId, nextDays = days) => {
    try {
      setReport(await api.reports({ job_id: nextJob || undefined, days: Number(nextDays) }));
    } catch (err) {
      setError((err as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load("", "365");
    api.jobs({ limit: 100 }).then((r) => setJobs(r.jobs)).catch(() => setJobs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sourceMax = Math.max(1, ...(report?.sources ?? []).map((s) => s.candidates));
  const funnelMax = Math.max(1, ...(report?.funnel ?? []).map((f) => f.reached));
  const reasonMax = Math.max(1, ...(report?.disqualify_reasons ?? []).map((r) => r.count));
  const monthMax = Math.max(1, ...(report?.over_time ?? []).map((m) => m.candidates));

  return (
    <>
      <Toolbar title="Reports" subtitle="Where candidates come from, and where they stop">
        <Select value={jobId} onChange={(e) => { setJobId(e.target.value); void load(e.target.value, days); }} className="w-52">
          <option value="">All jobs</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.title}
            </option>
          ))}
        </Select>
        <Segmented
          value={days}
          onChange={(next) => {
            setDays(next);
            void load(jobId, next);
          }}
          options={[
            { value: "90", label: "90d" },
            { value: "365", label: "1y" },
            { value: "1095", label: "3y" },
          ]}
        />
      </Toolbar>

      <div className="p-6">
        {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}

        <Card>
          <Zone className="grid grid-cols-2 gap-6 md:grid-cols-4">
            <Stat label="Candidates" value={report?.totals.candidates ?? "—"} meta="in this window" />
            <Stat
              label="Hired"
              value={report?.totals.hired ?? "—"}
              meta={
                report && report.totals.candidates
                  ? `${Math.round((report.totals.hired / report.totals.candidates) * 1000) / 10}% of applicants`
                  : ""
              }
            />
            <Stat label="Disqualified" value={report?.totals.disqualified ?? "—"} meta={report ? `${report.totals.active} still active` : ""} />
            <Stat
              label="Time to hire"
              value={report?.time_to_hire_days != null ? `${report.time_to_hire_days}d` : "—"}
              meta={report?.time_to_hire_days == null ? "no hires yet" : "application to hire"}
            />
          </Zone>
        </Card>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <Zone>
              <Eyebrow>Where candidates come from</Eyebrow>
              {report && report.sources.length === 0 ? (
                <Empty title="No applications in this window." />
              ) : (
                <ul className="mt-2">
                  {(report?.sources ?? []).map((source) => (
                    <Bar
                      key={source.source}
                      label={source.source.replace(/_/g, " ")}
                      value={source.candidates}
                      max={sourceMax}
                      meta={source.hired ? `${source.hired} hired · ${source.hire_rate}%` : undefined}
                    />
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[0.6875rem] text-faint">
                Volume is easy to get and easy to misread — the number that matters is the hire rate beside it.
              </p>
            </Zone>
          </Card>

          <Card>
            <Zone>
              <Eyebrow>How far people get</Eyebrow>
              {report && report.funnel.length === 0 ? (
                <Empty title="Nothing to chart yet." />
              ) : (
                <ul className="mt-2">
                  {(report?.funnel ?? []).map((stage) => (
                    <Bar key={`${stage.position}-${stage.stage}`} label={stage.stage} value={stage.reached} max={funnelMax} />
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[0.6875rem] text-faint">
                Everyone who ever reached the stage, not who is standing there now.
              </p>
            </Zone>
          </Card>

          <Card>
            <Zone>
              <Eyebrow>Why people are turned down</Eyebrow>
              {report && report.disqualify_reasons.length === 0 ? (
                <Empty title="Nobody disqualified in this window." />
              ) : (
                <ul className="mt-2">
                  {(report?.disqualify_reasons ?? []).map((reason) => (
                    <Bar key={reason.reason} label={reason.reason} value={reason.count} max={reasonMax} />
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[0.6875rem] text-faint">
                A pile of &ldquo;underqualified&rdquo; usually means the posting is wrong, not the applicants.
              </p>
            </Zone>
          </Card>

          <Card>
            <Zone>
              <Eyebrow>Volume over time</Eyebrow>
              {report && report.over_time.length === 0 ? (
                <Empty title="Nothing to chart yet." />
              ) : (
                <ul className="mt-2">
                  {(report?.over_time ?? []).map((month) => (
                    <Bar
                      key={month.month}
                      label={month.month}
                      value={month.candidates}
                      max={monthMax}
                      meta={month.hired ? `${month.hired} hired` : undefined}
                    />
                  ))}
                </ul>
              )}
            </Zone>
          </Card>
        </div>

        <div className="mt-4">
          <div className="mb-3">
            <span className="eyebrow">By job</span>
          </div>
          <div className="-mx-6 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-y border-border bg-sunken text-left">
                  {["Job", "Status", "Page views", "Candidates", "Hired"].map((heading, i) => (
                    <th
                      key={heading}
                      className={`px-3 py-2.5 text-xs font-semibold tracking-[0.04em] text-muted first:pl-6 last:pr-6 ${i >= 2 ? "text-right" : ""}`}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(report?.jobs ?? []).map((job) => (
                  <tr key={job.id} className="border-t border-border hover:bg-sunken">
                    <td className="px-3 py-2.5 text-[0.8125rem] first:pl-6">{job.title}</td>
                    <td className="px-3 py-2.5 text-[0.8125rem] text-muted">{job.status}</td>
                    <td className="data px-3 py-2.5 text-right text-[0.8125rem]">{job.views}</td>
                    <td className="data px-3 py-2.5 text-right text-[0.8125rem]">{job.candidates}</td>
                    <td className="data px-3 py-2.5 text-right text-[0.8125rem] last:pr-6">{job.hired}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
