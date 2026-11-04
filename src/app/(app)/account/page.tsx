import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMember } from "@/lib/session";
import { isFinance, ROLE_LABEL } from "@/lib/types";
import { EmailTest } from "./email-test";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const me = await requireMember();
  return (
    <>
      <PageHeader title="Account" description={`${me.name} · ${me.email} · ${ROLE_LABEL[me.role]}`} />
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Set a password to sign in without waiting for an email. Emailed links keep working too, and are how to get back
            in if you forget it. For your security you can set it only within 15 minutes of signing in.
          </CardDescription>
        </CardHeader>
        <CardContent><PasswordForm /></CardContent>
      </Card>
      {isFinance(me) && (
        <Card className="mt-6 max-w-xl">
          <CardHeader>
            <CardTitle>Claim emails</CardTitle>
            <CardDescription>
              Claim emails (submitted, approved, reimbursed) are sent by the app with the SMTP settings in Vercel, not by
              Supabase. Send yourself one to check they work; if they don&apos;t, you&apos;ll see why.
            </CardDescription>
          </CardHeader>
          <CardContent><EmailTest /></CardContent>
        </Card>
      )}
    </>
  );
}
