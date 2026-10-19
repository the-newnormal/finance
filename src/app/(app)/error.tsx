"use client";

import { Button } from "@/components/ui/button";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h1 className="font-serif text-3xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-ink-soft">Please try again. If it keeps happening, let an admin know.</p>
      <Button className="mt-6" onClick={reset}>Try again</Button>
    </div>
  );
}
