"use client";

import { Button } from "@/components/ui/button";

// Errors anywhere below the root layout, including a layout's own (e.g. a failed member lookup),
// which a segment's error.tsx can't catch.
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center px-4 text-center">
      <div>
        <h1 className="font-serif text-3xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-ink-soft">Please try again. If it keeps happening, let an admin know.</p>
        <Button className="mt-6" onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
