import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ActivityRow } from "../api";
import { Chip, Empty, Segmented, Toolbar } from "../components/ui";

type Filter = "all" | "stage_changed" | "screening" | "disqualified" | "note" | "evaluation" | "message";

export default function ActivityFeed() {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState("");

  const load = useCallback(async (next: Filter) => {
    try {
      const { activity } = await api.activity({ kind: next === "all" ? undefined : next, limit: 100 });
      setRows(activity);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load("all");
  }, [load]);

  return (
    <>
      <Toolbar title="Activity" subtitle="Who did what, and whether it was a person" />

      <div className="p-6">
        {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}

        <div className="mb-3">
          <Segmented
            value={filter}
            onChange={(next) => {
              setFilter(next);
              void load(next);
            }}
            options={[
              { value: "all", label: "Everything" },
              { value: "stage_changed", label: "Moves" },
              { value: "screening", label: "Screening" },
              { value: "disqualified", label: "Rejections" },
              { value: "note", label: "Notes" },
              { value: "evaluation", label: "Evaluations" },
              { value: "message", label: "Messages" },
            ]}
          />
        </div>

        {rows && rows.length === 0 ? (
          <Empty title="Nothing here yet." hint="Every change to a candidate's record shows up here." />
        ) : (
          // The full-bleed list shape: -mx-6 on the container, px-6 back on
          // each row, so the hairlines reach both edges.
          <div className="-mx-6 border-t border-border">
            <ul>
              {(rows ?? []).map((row) => (
                <li key={row.id} className="flex items-start gap-3 border-b border-border px-6 py-2.5 hover:bg-sunken">
                  <Chip>{row.actor_kind}</Chip>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.8125rem]">{row.summary}</p>
                    <p className="text-[0.6875rem] text-faint">
                      {row.actor_name || row.actor_kind}
                      {row.candidate_name ? (
                        <>
                          {" · "}
                          <Link className="link" to={`/candidates/${row.candidate_id}`}>
                            {row.candidate_name}
                          </Link>
                        </>
                      ) : null}
                      {row.job_title ? ` · ${row.job_title}` : ""}
                    </p>
                  </div>
                  <span className="data shrink-0 text-[0.6875rem] text-faint">{row.created_at.slice(0, 16)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
