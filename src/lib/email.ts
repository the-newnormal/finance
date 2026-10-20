import "server-only";

import nodemailer, { type Transporter } from "nodemailer";
import { renderEmail, type Email } from "@/lib/email-template";

/**
 * Sends e-mail over SMTP (Gmail by default: smtp.gmail.com:465 with an app
 * password). If SMTP isn't configured, nothing is sent and only an error code
 * is logged, never the e-mail itself.
 *
 * Failures are logged, never thrown: a claim approval must not fail just
 * because a notification couldn't be delivered.
 */

let transporter: Transporter | null = null;

function getTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) return null;
  const port = Number(SMTP_PORT ?? 465);
  transporter ??= nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465, // implicit TLS on 465
    requireTLS: port !== 465, // and STARTTLS required on any other port: never send the password in clear
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    // Fail fast rather than hold a function open for minutes on an unreachable server.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

export async function sendEmail(to: string, email: Email) {
  const { html, text } = renderEmail(email, process.env.NEXT_PUBLIC_SITE_URL || undefined);

  const t = getTransporter();
  if (!t) {
    // Logs carry codes only (CLAUDE.md), so the email itself is never printed. To see them locally,
    // set SMTP_* to a real mailbox.
    console.error("email not sent", { code: "smtp_not_configured" });
    return;
  }
  try {
    await t.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER, // || so a blank MAIL_FROM falls back too
      to,
      subject: email.subject,
      html,
      text,
    });
  } catch (e) {
    console.error("email failed", { code: (e as { code?: string })?.code ?? "unknown" });
  }
}
