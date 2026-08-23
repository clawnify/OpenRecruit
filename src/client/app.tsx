import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { Activity, BarChart3, Briefcase, LayoutDashboard, Settings2, Users } from "lucide-react";
import Dashboard from "./routes/dashboard";
import Jobs from "./routes/jobs";
import Job from "./routes/job";
import Candidates from "./routes/candidates";
import Candidate from "./routes/candidate";
import Reports from "./routes/reports";
import ActivityFeed from "./routes/activity";
import Settings from "./routes/settings";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/jobs", label: "Jobs", icon: Briefcase },
  { to: "/candidates", label: "Candidates", icon: Users },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/settings", label: "Settings", icon: Settings2 },
];

export default function App() {
  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-[16.25rem] shrink-0 flex-col border-r border-border bg-surface md:flex">
        {/* h-14 here and on Toolbar: the sidebar brand row and the page header
            must share one height so their bottom borders form a single
            unbroken line across the app. Padding-derived heights drift the
            moment a page title gains or loses a subtitle. */}
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <Briefcase className="size-4 text-primary" strokeWidth={2.5} />
          <span className="text-sm font-semibold">Open Recruit</span>
        </div>
        <nav className="p-2">
          <div className="px-2 py-1.5">
            <span className="eyebrow">Hiring</span>
          </div>
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  isActive
                    ? "bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] font-semibold text-primary"
                    : "text-foreground hover:bg-sunken"
                }`
              }
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto border-t border-border p-3">
          <a className="link text-xs text-muted" href="/careers" target="_blank" rel="noopener">
            View the careers site
          </a>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/jobs/:id" element={<Job />} />
          <Route path="/candidates" element={<Candidates />} />
          <Route path="/candidates/:id" element={<Candidate />} />
          <Route path="/applications/:id" element={<Candidate />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/activity" element={<ActivityFeed />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
