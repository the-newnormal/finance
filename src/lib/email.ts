import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

/**
 * Sends e-mail over SMTP (Gmail by default: smtp.gmail.com:465 with an app
 * password). If SMTP isn't configured, nothing is sent; in development the
 * e-mail is printed instead.
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

export async function sendEmail(to: string, subject: string, paragraphs: string[], link?: { href: string; label: string }) {
  // Without the site's URL a relative link would be useless in an email, so leave the button out.
  const appUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const href = link ? (link.href.startsWith("http") ? link.href : appUrl ? appUrl + link.href : null) : null;
  const html = `
  <div style="font-family:Inter,Arial,sans-serif;color:#34363e;background:#f7f5f1;padding:32px">
    <div style="max-width:520px;margin:auto;background:#fff;border-radius:16px;padding:28px">
      <p style="font-family:Georgia,serif;font-size:22px;margin:0 0 16px">New Normal</p>
      ${paragraphs.map((p) => `<p style="line-height:1.6;margin:0 0 12px">${escapeHtml(p)}</p>`).join("")}
      ${href ? `<p style="margin-top:20px"><a href="${escapeHtml(href)}" style="background:#2f7f9b;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">${escapeHtml(link!.label)}</a></p>` : ""}
    </div>
  </div>`;
  const text = [...paragraphs, href ?? ""].join("\n\n");

  const t = getTransporter();
  if (!t) {
    // Logs carry codes only (CLAUDE.md), so the email itself is never printed. Locally, use Mailpit
    // or set SMTP_* to see real ones.
    console.error("email not sent", { code: "smtp_not_configured" });
    return;
  }
  try {
    await t.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER, // || so a blank MAIL_FROM falls back too
            to,
      subject,
      html,
      text,
    });
  } catch (e) {
    console.error("email failed", { code: (e as { code?: string })?.code ?? "unknown" });
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
