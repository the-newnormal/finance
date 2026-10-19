import * as React from "react";
import { cn } from "@/lib/utils";

export const fieldClass =
  "flex w-full rounded-xl border border-line bg-surface px-3.5 py-2 text-sm text-ink placeholder:text-ink-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 disabled:opacity-50";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(fieldClass, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(fieldClass, "min-h-24", className)} {...props} />;
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(fieldClass, "h-10 appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9", className)}
    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2334363e' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
    {...props} />;
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium text-ink", className)} {...props} />;
}

// A label and its control. The label wraps the control, so screen readers name it and clicking the
// label focuses it. For several controls under one heading (radios, toggle buttons), pass `group`:
// a fieldset whose legend names them all. content-start keeps label and control at the top when a
// neighbouring field in the same row is taller (e.g. has a hint), so inputs line up across columns.
export function Field({ label, hint, children, className, group }: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
  group?: boolean;
}) {
  const body = (
    <>
      {hint && <span className="order-last text-xs text-ink-soft">{hint}</span>}
      {children}
    </>
  );
  if (group) {
    return (
      <fieldset className={cn("grid content-start gap-1.5", className)}>
        <legend className="mb-1.5 text-sm font-medium text-ink">{label}</legend>
        {body}
      </fieldset>
    );
  }
  return (
    <label className={cn("grid content-start gap-1.5", className)}>
      <span className="text-sm font-medium text-ink">{label}</span>
      {body}
    </label>
  );
}
