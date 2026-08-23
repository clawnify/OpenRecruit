import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarDays, CheckSquare, Clock, ScanSearch } from "lucide-react";
import { api } from "../api";
import { Avatar, Card, Empty, Eyebrow, Stat, Toolbar, Zone } from "../components/ui";

type Data = Awaited<ReturnType<typeof api.dashboard>>;

function when(value: string | null): string {
  if (!value) return "no date";
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function Dashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.dashboard().then(setData).catch((err) => setError((err as Error).message));
  }, []);

  return (
    <>
      <Toolbar title="Dashboard" subtitle="What needs you today" />

      <div className="p-6">
        {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}

        {/* The four numbers, and the three of them that are a call to action.
            A dashboard of twenty tiles is one nobody reads. */}
        <Card>
          <Zone className="grid grid-cols-2 gap-6 md:grid-cols-4">
            <Stat
              label="Open jobs"
              value={data?.open_jobs ?? "—"}
              meta={data ? `${data.published_jobs} published` : ""}
            />
            <Stat
              label="In pipeline"
              value={data?.active_candidates ?? "—"}
              meta={data ? `${data.new_this_week} new this week` : ""}
            />
            <Stat
              label="Awaiting screening"
              value={data?.awaiting_screening ?? "—"}
              meta={data?.flagged ? `${data.flagged} flagged` : ""}
            />
            <Stat
              label="Waiting too long"
              value={data?.overdue ?? "—"}
              meta={data?.overdue ? "past their stage limit" : "all within limits"}
            />
          </Zone>
        </Card>

        {data && (data.overdue > 0 || data.flagged > 0) ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-warning-tint px-4 py-3 text-[0.8125rem] text-warning">
            <AlertTriangle className="size-4 shrink-0" strokeWidth={2.5} />
            {data.overdue > 0 ? (
              <span>
                {data.overdue} candidate{data.overdue === 1 ? " has" : "s have"} been sitting in one stage past its limit.
              </span>
            ) : null}
            {data.flagged > 0 ? <span>{data.flagged} flagged by a screening question.</span> : null}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <Zone>
              <Eyebrow right={data ? `${data.jobs.length}` : undefined}>Jobs</Eyebrow>
              {data && data.jobs.length === 0 ? (
                <Empty title="No jobs open yet." hint="Open one and it appears on your careers site the moment you publish it." />
              ) : (
                <ul className="mt-2 divide-y divide-border">
                  {(data?.jobs ?? []).map((job) => (
                    <li key={job.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <Link to={`/jobs/${job.id}`} className="link text-sm font-medium">
                          {job.title}
                        </Link>
                        <p className="text-xs text-muted">
                          {job.department || "No department"} · {job.status}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-4">
                        {job.new_count > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--primary)_28%,transparent)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] px-2 py-0.5 text-xs text-primary">
                            <ScanSearch className="size-3" strokeWidth={2.5} />
                            {job.new_count} new
                          </span>
                        ) : null}
                        <span className="data text-[0.8125rem] text-muted">{job.active_count}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Zone>
          </Card>

          <div className="space-y-4">
            <Card>
              <Zone>
                <Eyebrow>Coming up</Eyebrow>
                {data && data.interviews.length === 0 ? (
                  <p className="mt-3 text-sm text-muted">Nothing scheduled.</p>
                ) : (
                  <ul className="mt-2 space-y-2.5">
                    {(data?.interviews ?? []).map((interview) => (
                      <li key={interview.id} className="flex items-start gap-2.5">
                        <Avatar name={interview.candidate_name ?? "?"} size={24} />
                        <div className="min-w-0">
                          <p className="truncate text-[0.8125rem] font-medium">{interview.candidate_name}</p>
                          <p className="flex items-center gap-1 text-[0.6875rem] text-muted">
                            <CalendarDays className="size-3" />
                            {when(interview.starts_at)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Zone>
            </Card>

            <Card>
              <Zone>
                <Eyebrow right={data ? `${data.my_tasks} yours` : undefined}>Tasks</Eyebrow>
                {data && data.tasks.length === 0 ? (
                  <p className="mt-3 text-sm text-muted">Nothing outstanding.</p>
                ) : (
                  <ul className="mt-2 space-y-2.5">
                    {(data?.tasks ?? []).map((task) => (
                      <li key={task.id} className="flex items-start gap-2.5">
                        <CheckSquare className="mt-0.5 size-3.5 shrink-0 text-faint" />
                        <div className="min-w-0">
                          <p className="truncate text-[0.8125rem]">{task.title}</p>
                          <p className="flex items-center gap-1 text-[0.6875rem] text-muted">
                            {task.candidate_name ? `${task.candidate_name} · ` : ""}
                            {task.due_at ? (
                              <>
                                <Clock className="size-3" />
                                {task.due_at}
                              </>
                            ) : (
                              "no date"
                            )}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Zone>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
