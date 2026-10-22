import type { Metadata } from "next";
import { BrandField } from "@/components/brand-field";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { safeNextPath } from "@/lib/auth/safe-next";

export const metadata: Metadata = { title: "Continue signing in" };

// One click between the email link and signing in, so an email scanner that opens the link can't
// use up its one-time token (/auth/callback explains). Nothing here signs anyone in on its own.
export default async function ConfirmPage({ searchParams }: PageProps<"/auth/confirm">) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const invite = one(params.type) === "invite";

  return (
    <main className="relative grid min-h-dvh place-items-center px-4 py-10">
      <BrandField />
      <div className="w-full max-w-sm text-center">
        <div className="mb-8 flex justify-center"><Logo size={44} /></div>
        <div className="rounded-3xl border border-white/60 bg-white/70 p-6 shadow-[0_8px_40px_rgba(52,54,62,.08)] backdrop-blur-xl sm:p-8">
          <h1 className="font-serif text-2xl font-semibold">{invite ? "Welcome to Normal Finance" : "Continue signing in"}</h1>
          <p className="mt-1 text-sm text-ink-soft">Press the button to finish signing in on this device.</p>
          <form action="/auth/callback" method="post" className="mt-6">
            <input type="hidden" name="token_hash" value={one(params.token_hash)} />
            <input type="hidden" name="type" value={invite ? "invite" : "email"} />
            <input type="hidden" name="next" value={safeNextPath(one(params.next))} />
            <Button type="submit" size="lg" className="w-full">Continue</Button>
          </form>
        </div>
      </div>
    </main>
  );
}
