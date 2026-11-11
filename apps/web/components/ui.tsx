"use client";

import { useEffect, useId, useRef } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { label as humanize } from "@/lib/format";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const BUTTON = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 border-transparent",
  secondary: "bg-white text-slate-800 hover:bg-slate-50 border-slate-300",
  danger: "bg-white text-red-700 hover:bg-red-50 border-red-300",
  ghost: "bg-transparent text-slate-600 hover:bg-slate-100 border-transparent",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        BUTTON[variant],
        className,
      )}
    />
  );
}

const CONTROL =
  "block w-full rounded-md border border-slate-300 bg-white px-3 h-9 text-sm text-slate-900 placeholder:text-slate-400 " +
  "disabled:bg-slate-50 disabled:text-slate-500 aria-[invalid=true]:border-red-500";

export function Field({
  label,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">
        {label}
      </label>
      {children({ id, "aria-invalid": !!error, "aria-describedby": error || hint ? noteId : undefined })}
      {(error || hint) && (
        <p id={noteId} className={cx("mt-1 text-xs", error ? "text-red-600" : "text-slate-500")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(CONTROL, p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(CONTROL, "pr-8", p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea rows={3} {...p} className={cx(CONTROL, "h-auto py-2", p.className)} />
);

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-lg border border-slate-200 bg-white", className)}>{children}</section>;
}

export function CardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {action}
    </div>
  );
}

const TONES: Record<string, string> = {
  slate: "bg-slate-100 text-slate-700",
  blue: "bg-blue-50 text-blue-700",
  amber: "bg-amber-50 text-amber-800",
  violet: "bg-violet-50 text-violet-700",
  green: "bg-emerald-50 text-emerald-700",
  red: "bg-red-50 text-red-700",
};

const STATUS_TONE: Record<string, string> = {
  pending: "amber", assigned: "blue", dispatched: "violet", in_transit: "violet", delivered: "blue",
  completed: "green", invoiced: "slate", paid: "green", cancelled: "red",
  active: "green", inactive: "slate", maintenance: "amber",
  sent: "blue", void: "slate", overdue: "red", expired: "red", soon: "amber",
};

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: string }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONES[tone] ?? TONES.slate)}>
      {children}
    </span>
  );
}

export const StatusBadge = ({ status }: { status: string }) => (
  <Badge tone={STATUS_TONE[status] ?? "slate"}>{humanize(status)}</Badge>
);

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : "Something went wrong";
  return (
    <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {message}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-slate-500">{children}</div>;
}

export function Loading() {
  return (
    <div className="px-4 py-10 text-center text-sm text-slate-400" role="status">
      Loading…
    </div>
  );
}

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
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx("m-auto w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-0 shadow-xl", wide ? "max-w-2xl" : "max-w-lg")}
    >
      {open && (
        <>
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
              ✕
            </Button>
          </div>
          <div className="px-5 py-4">{children}</div>
        </>
      )}
    </dialog>
  );
}

export const Th = ({ children, right }: { children?: ReactNode; right?: boolean }) => (
  <th scope="col" className={cx("px-4 py-2 text-xs font-medium whitespace-nowrap text-slate-500", right ? "text-right" : "text-left")}>
    {children}
  </th>
);

export const Td = ({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) => (
  <td className={cx("px-4 py-2.5 text-sm whitespace-nowrap text-slate-700", right && "text-right tabular-nums", className)}>{children}</td>
);

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead className="border-b border-slate-200 bg-slate-50/60">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}
