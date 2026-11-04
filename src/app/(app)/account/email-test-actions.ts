"use server";

import { sendEmail } from "@/lib/email";
import { requireFinance } from "@/lib/session";

export type EmailTestResult = { sent: true; to: string } | { sent: false; code: string; hint: string };

const HINTS: Record<string, string> = {
  smtp_not_configured: "SMTP_HOST, SMTP_USER or SMTP_PASSWORD isn't set in Vercel (or the app wasn't redeployed after setting them).",
  EAUTH: "The mail server refused the login. For Gmail, SMTP_PASSWORD must be an app password for the SMTP_USER account, with 2-Step Verification on.",
  EENVELOPE: "The sender or recipient address was refused. Check MAIL_FROM: an address, or Name <address>.",
  EMESSAGE: "The message was refused. Check MAIL_FROM: an address, or Name <address>.",
  ETIMEDOUT: "The mail server didn't answer. Check SMTP_HOST and SMTP_PORT (smtp.gmail.com and 465 for Gmail).",
  ECONNECTION: "Couldn't connect to the mail server. Check SMTP_HOST and SMTP_PORT (smtp.gmail.com and 465 for Gmail).",
  ESOCKET: "The connection to the mail server failed. Check SMTP_HOST and SMTP_PORT (smtp.gmail.com and 465 for Gmail).",
  EDNS: "SMTP_HOST isn't a mail server that can be found. Check its spelling.",
};

// Finance sends one test email to themselves through the app's own sender (the one claim emails
// use, not Supabase's), and sees what happened: sent, or the mail server's error code with what it
// usually means. Only to the signed-in member's own address, so it can't be used to mail anyone else.
export async function sendTestEmail(): Promise<EmailTestResult> {
  const me = await requireFinance();
  const result = await sendEmail(me.email, {
    subject: "Normal Finance test email",
    badge: { label: "Test", tone: "info" },
    heading: "Emails from Normal Finance are working",
    paragraphs: [`Hi ${me.name.split(" ")[0]},`, "You asked for this from your Account page. Claim emails go out the same way."],
  });
  if (result.sent) return { sent: true, to: me.email };
  return { sent: false, code: result.code, hint: HINTS[result.code] ?? "The mail server refused it. Check every SMTP_ setting and MAIL_FROM in Vercel." };
}
