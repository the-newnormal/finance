import { Button } from "@/components/ui/button";
import { getMe } from "@/lib/session";
import { redirect } from "next/navigation";

export const metadata = { title: "Account not active" };

// Signed in, but there's no active member row for this login (never set up, or deactivated).
export default async function InactivePage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.member) redirect("/claims");
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="max-w-sm">
        <h1 className="font-serif text-3xl font-semibold">Your account isn&apos;t active</h1>
        <p className="mt-2 text-ink-soft">Ask a New Normal admin to set up or reactivate your account.</p>
        <form action="/auth/signout" method="post" className="mt-6">
          <Button type="submit" variant="outline">Sign out</Button>
        </form>
      </div>
    </main>
  );
}
