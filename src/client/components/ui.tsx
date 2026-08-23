// The shared vocabulary. Chips are facts; badges are signals — the two are
// deliberately different shapes so a glance tells you which you're reading.

import type { ReactNode } from "react";

export function Eyebrow({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="eyebrow">{children}</span>
      {right ? <span className="data text-[0.6875rem] text-faint">{right}</span> : null}
    </div>
  );
}

/** A card is anatomy, not a padded box: stacked zones split by hairlines. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-border bg-surface ${className}`}>{children}</div>;
}

export function Zone({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`border-b border-border p-4 last:border-b-0 ${className}`}>{children}</div>;
}

/** Enumerable fact — file type, column type, page number. Quiet by design. */
export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-border bg-sunken px-1.5 py-0.5 text-[0.6875rem] text-muted">
      {children}
    </span>
  );
}

type Tone = "success" | "warning" | "danger" | "neutral";

const TONES: Record<Tone, string> = {
  success: "bg-success-tint text-success border-success/25",
  warning: "bg-warning-tint text-warning border-warning/25",
  danger: "bg-danger-tint text-danger border-danger/25",
  neutral: "bg-sunken text-muted border-border",
};

/** Status that wants attention. Pill-shaped, normal weight — quiet, not bold. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-normal ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
  type = "button",
  title,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
  className?: string;
}) {
  // shrink-0 + whitespace-nowrap: a button label must never wrap. In a fixed
  // height toolbar a wrapped label doesn't just look wrong, it overflows the
  // row — the label is the shortest thing on screen, so the space comes from
  // somewhere else.
  const base =
    "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-2 h-8 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none";
  const variants = {
    // Darkens on hover, never lightens. Exactly one of these per screen.
    primary: "bg-primary text-on-primary hover:bg-primary-hover",
    secondary: "border border-border bg-surface text-foreground hover:bg-sunken",
    ghost: "text-muted hover:bg-sunken hover:text-foreground",
    danger: "border border-border bg-surface text-danger hover:bg-danger-tint",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-9 w-full rounded-sm border border-border bg-surface px-2.5 text-[0.8125rem] text-foreground placeholder:text-faint focus:border-ring focus:outline-none ${props.className ?? ""}`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-sm border border-border bg-surface px-2.5 py-2 text-[0.8125rem] text-foreground placeholder:text-faint focus:border-ring focus:outline-none ${props.className ?? ""}`}
    />
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold tracking-[0.04em] text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[0.6875rem] text-faint">{hint}</span> : null}
    </label>
  );
}

/**
 * Borderless by design: an empty bordered box reads as a component that failed
 * to load. The border earns its place once there is something to contain.
 */
export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-sm text-muted">{title}</p>
      {hint ? <p className="mt-1 text-xs text-faint">{hint}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Toolbar({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    // h-14 matches the sidebar brand row so the two bottom borders form one
    // unbroken line. Never height this from padding — it drifts the moment a
    // page has no subtitle.
    <div className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b border-border bg-background px-6">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold tracking-[-0.01em]">{title}</h1>
        {subtitle ? <p className="truncate text-xs text-muted">{subtitle}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * Modal. Uses the native <dialog> element so Esc, focus trapping and the
 * top layer come from the platform rather than from a hand-rolled overlay —
 * and so it works in agent mode, where hover-only affordances do not.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    // The overlay is the scroll container. Hard-centring a dialog taller than
    // the viewport clips its first field AND its footer with no way to reach
    // either, and a form grows the moment somebody adds a field.
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/30" onClick={onClose}>
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-xl border border-border bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.16)]`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-base font-semibold">{title}</h2>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Every form control in the app is one of these, so they stay one shape. */
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`h-9 w-full rounded-sm border border-border bg-surface px-2 text-[0.8125rem] text-foreground focus:border-ring focus:outline-none ${props.className ?? ""}`}
    />
  );
}

/**
 * View switcher. The active segment is a raised white pill on a sunken track —
 * never an ink fill, which would read as an accent or a call to action.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg bg-sunken p-0.5" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-sm px-2.5 py-1 text-sm font-medium transition-colors ${
            value === option.value
              ? "border border-border bg-surface text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
              : "border border-transparent text-muted hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Ten muted pairs, picked by hashing the value so the same tag is the same
 * colour everywhere. This is the one place chroma belongs: it is data, not
 * chrome.
 */
const PILL_COLORS = [
  "bg-[#FEF2F2] text-[#DC2626] dark:bg-[color-mix(in_srgb,#DC2626_12%,transparent)] dark:text-[#DC2626]",
  "bg-[#ECFDF5] text-[#059669] dark:bg-[color-mix(in_srgb,#059669_12%,transparent)] dark:text-[#059669]",
  "bg-[#EFF6FF] text-[#2563EB] dark:bg-[color-mix(in_srgb,#2563EB_12%,transparent)] dark:text-[#2563EB]",
  "bg-[#FFFBEB] text-[#D97706] dark:bg-[color-mix(in_srgb,#D97706_12%,transparent)] dark:text-[#D97706]",
  "bg-[#F5F3FF] text-[#7C3AED] dark:bg-[color-mix(in_srgb,#7C3AED_12%,transparent)] dark:text-[#7C3AED]",
  "bg-[#F0FDFA] text-[#0D9488] dark:bg-[color-mix(in_srgb,#0D9488_12%,transparent)] dark:text-[#0D9488]",
  "bg-[#FDF2F8] text-[#DB2777] dark:bg-[color-mix(in_srgb,#DB2777_12%,transparent)] dark:text-[#DB2777]",
  "bg-[#FFF7ED] text-[#EA580C] dark:bg-[color-mix(in_srgb,#EA580C_12%,transparent)] dark:text-[#EA580C]",
  "bg-[#FAF5FF] text-[#9333EA] dark:bg-[color-mix(in_srgb,#9333EA_12%,transparent)] dark:text-[#9333EA]",
  "bg-[#F0FDF4] text-[#16A34A] dark:bg-[color-mix(in_srgb,#16A34A_12%,transparent)] dark:text-[#16A34A]",
];

export function pillColor(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return PILL_COLORS[Math.abs(hash) % PILL_COLORS.length];
}

/** A data pill — a tag, a source, a category. A fact, not a status. */
export function Pill({ children }: { children: string }) {
  return (
    <span className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[0.6875rem] ${pillColor(children)}`}>
      {children}
    </span>
  );
}

/** Initials, so a list of people reads as people without loading a photo. */
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold ${pillColor(name || "?")}`}
      style={{ width: size, height: size }}
    >
      {initials || "?"}
    </span>
  );
}

/** A stat with a fixed-height meta line, so toggling state never shifts layout. */
export function Stat({ label, value, meta }: { label: string; value: ReactNode; meta?: ReactNode }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className="data mt-1 text-2xl font-bold leading-none">{value}</p>
      <p className="mt-1 h-4 text-[0.6875rem] text-muted">{meta ?? ""}</p>
    </div>
  );
}
