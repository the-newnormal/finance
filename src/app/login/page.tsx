import type { Metadata } from "next";
import { BrandField } from "@/components/brand-field";
import { Logo } from "@/components/logo";
import { safeNextPath } from "@/lib/auth/safe-next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS = new Map([
  ["link", "That sign-in link has expired or was already used. Request a new one below."],
]);

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const next = safeNextPath(one(params.next));
  const error = ERRORS.get(one(params.error) ?? "");

  return (
    <main className="relative grid min-h-dvh place-items-center px-4 py-10">
      <BrandField />
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center"><Logo size={44} /></div>
        <div className="rounded-3xl border border-white/60 bg-white/70 p-6 shadow-[0_8px_40px_rgba(52,54,62,.08)] backdrop-blur-xl sm:p-8">
          <h1 className="font-serif text-2xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-ink-soft">With an emailed link, or your password if you&apos;ve set one.</p>
          <LoginForm next={next} notice={error} />
        </div>
        <p className="mt-6 text-center text-xs text-ink-soft">
          Accounts are created by Normal Finance. Need access? Ask your event lead.
        </p>
      </div>
    </main>
  );
}
