"use client";

import { AlertDialog as Primitive } from "radix-ui";
import { cn } from "@/lib/utils";

// A pop-up that asks before going on (Radix's alert dialog: focus stays in it, Escape cancels).

export const AlertDialog = Primitive.Root;
export const AlertDialogAction = Primitive.Action;
export const AlertDialogCancel = Primitive.Cancel;

export function AlertDialogContent({ className, children, ...props }: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-50 bg-ink/40" />
      <Primitive.Content
        className={cn("fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl border border-line bg-surface p-5 shadow-lg", className)}
        {...props}>
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  );
}

export function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof Primitive.Title>) {
  return <Primitive.Title className={cn("flex items-center gap-2 font-semibold", className)} {...props} />;
}

export function AlertDialogDescription({ className, ...props }: React.ComponentProps<typeof Primitive.Description>) {
  return <Primitive.Description className={cn("text-sm text-ink-soft", className)} {...props} />;
}
