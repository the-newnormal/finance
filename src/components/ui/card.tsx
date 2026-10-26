import * as React from "react";
import { cn } from "@/lib/utils";

// min-w-0: a card is often a grid item (pages stack them in grids), and a grid item otherwise grows
// to its content's width, so a wide table would push the card past its column into its neighbour.
// With it, the card keeps to its column and the table scrolls inside.
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 rounded-2xl border border-line bg-surface/90 shadow-[0_1px_2px_rgba(52,54,62,.04)] backdrop-blur", className)} {...props} />;
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-5 pb-3 sm:p-6 sm:pb-3", className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("font-serif text-xl font-semibold leading-tight", className)} {...props} />;
}
export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-ink-soft", className)} {...props} />;
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pt-0 sm:p-6 sm:pt-0", className)} {...props} />;
}
