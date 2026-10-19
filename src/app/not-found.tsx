import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <h1 className="font-serif text-4xl font-semibold">Not found</h1>
        <p className="mt-2 text-ink-soft">That page doesn&apos;t exist, or you don&apos;t have access to it.</p>
        <Button asChild className="mt-6"><Link href="/claims">Back to my claims</Link></Button>
      </div>
    </main>
  );
}
