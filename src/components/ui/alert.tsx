import { cn } from "@/lib/utils";

export function Alert({ tone = "error", children, className }: { tone?: "error" | "info" | "success"; children: React.ReactNode; className?: string }) {
  const styles = {
    error: "border-danger/30 bg-danger/5 text-danger",
    info: "border-brand/30 bg-teal/20 text-ink",
    success: "border-brand-deep/30 bg-teal/30 text-ink",
  }[tone];
  return <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-xl border px-4 py-3 text-sm", styles, className)}>{children}</div>;
}
