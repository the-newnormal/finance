// The layout every email from the app shares: a branded card with a heading, the message, the
// claim's details, an optional highlighted note (a rejection's reason) and a button back to the app.
// Built from tables with inline styles, which is what email clients render reliably. Every value
// is escaped: descriptions, names and reasons are typed by members.

export type Tone = "info" | "success" | "warning" | "paid";

export type Email = {
  subject: string;
  /** A short label above the heading, e.g. "Approved". */
  badge?: { label: string; tone: Tone };
  heading: string;
  /** The message, a paragraph each; the first is usually the greeting. */
  paragraphs: string[];
  /** Label and value rows, e.g. the claim's description, amount and budget. */
  details?: [label: string, value: string][];
  /** Text the reader most needs, set apart: a rejection's reason. */
  callout?: { label: string; text: string };
  /** A last line after the details and callout: what to do next. */
  closing?: string;
  link?: { href: string; label: string };
};

// From src/app/globals.css (newnormal.sg's tokens).
const C = {
  base: "#f7f5f1",
  surface: "#ffffff",
  ink: "#34363e",
  soft: "#6b6d74",
  line: "#e6e5e2",
  brand: "#60aecb",
  brandDeep: "#2f7f9b",
};

const TONES: Record<Tone, { bar: string; pillBg: string; pillInk: string }> = {
  info: { bar: C.brand, pillBg: "#e3f1f6", pillInk: "#22677f" },
  success: { bar: "#5aa889", pillBg: "#e2f2eb", pillInk: "#2d6b52" },
  warning: { bar: "#f5a470", pillBg: "#fdeee3", pillInk: "#9a4a17" },
  paid: { bar: "#8a8cd1", pillBg: "#ecebf8", pillInk: "#4f4f9a" },
};

const SANS = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const SERIF = "Newsreader,Georgia,'Times New Roman',serif";

/** The rows that say which claim an email is about. */
export function claimDetails(c: { description?: string | null; vendor?: string | null; amount: string; budget?: string | null }): [string, string][] {
  const rows: [string, string | null | undefined][] = [["For", c.description], ["Vendor", c.vendor], ["Amount", c.amount], ["Budget", c.budget]];
  return rows.filter((r): r is [string, string] => !!r[1]);
}

/**
 * The email's HTML and plain-text bodies. `appUrl` (the site's address) makes the button's link
 * absolute and shows the logo; without it the button is left out, since a relative link is useless
 * in an email.
 */
export function renderEmail(email: Email, siteUrl?: string): { html: string; text: string } {
  const appUrl = siteUrl?.replace(/\/+$/, "") || undefined;
  const href = email.link
    ? email.link.href.startsWith("https://") || email.link.href.startsWith("http://")
      ? email.link.href
      : appUrl ? appUrl + email.link.href : null
    : null;
  const tone = TONES[email.badge?.tone ?? "info"];
  const preheader = email.paragraphs.find((p) => !/^Hi\b/.test(p)) ?? email.heading;

  const badge = email.badge
    ? `<p style="margin:0 0 14px"><span style="display:inline-block;background:${tone.pillBg};color:${tone.pillInk};font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;padding:4px 10px;border-radius:999px">${esc(email.badge.label)}</span></p>`
    : "";
  const paragraphs = email.paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${C.ink}">${esc(p)}</p>`)
    .join("");
  const details = email.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;background:${C.base};border-radius:12px;border-collapse:separate">
        ${email.details.map(([label, value], i) => `<tr>
          <td valign="top" style="padding:${i ? "0" : "14px"} 16px 12px;width:84px;font-size:13px;color:${C.soft};white-space:nowrap">${esc(label)}</td>
          <td valign="top" style="padding:${i ? "0" : "14px"} 16px 12px 0;font-size:14px;line-height:1.5;color:${C.ink};font-weight:600">${esc(value)}</td>
        </tr>`).join("")}
        <tr><td colspan="2" style="height:2px;line-height:2px;font-size:0">&nbsp;</td></tr>
      </table>`
    : "";
  const callout = email.callout
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px">
        <tr><td style="border-left:4px solid ${tone.bar};background:${tone.pillBg};border-radius:0 10px 10px 0;padding:12px 16px">
          <p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${tone.pillInk}">${esc(email.callout.label)}</p>
          <p style="margin:0;font-size:15px;line-height:1.6;color:${C.ink};white-space:pre-line">${esc(email.callout.text)}</p>
        </td></tr>
      </table>`
    : "";
  const closing = email.closing
    ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${C.ink}">${esc(email.closing)}</p>`
    : "";
  const button = href
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px">
        <tr><td style="background:${C.brandDeep};border-radius:999px">
          <a href="${esc(href)}" style="display:inline-block;padding:12px 24px;font-family:${SANS};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px">${esc(email.link!.label)}</a>
        </td></tr>
      </table>`
    : "";
  const logo = appUrl
    ? `<td valign="middle" style="padding-right:10px"><img src="${esc(appUrl)}/email-logo.png" width="36" height="36" alt="" style="display:block;border:0"></td>`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(email.subject)}</title>
<style>
@media only screen and (max-width:480px) {
  .nn-outer { padding:20px 10px !important; }
  .nn-card { padding:24px 20px 26px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background:${C.base};font-family:${SANS};color:${C.ink}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.base}">
  <tr><td class="nn-outer" align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
      <tr><td style="padding:0 4px 18px">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          ${logo}
          <td valign="middle" style="font-family:${SERIF};font-size:19px;font-weight:600;color:${C.ink};line-height:1.1">New Normal<br><span style="font-family:${SANS};font-size:11px;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;color:${C.soft}">Finance</span></td>
        </tr></table>
      </td></tr>
      <tr><td style="background:${C.surface};border:1px solid ${C.line};border-radius:16px;overflow:hidden">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="height:6px;line-height:6px;font-size:0;background:${tone.bar}">&nbsp;</td></tr>
          <tr><td class="nn-card" style="padding:28px 32px 30px">
            ${badge}
            <h1 style="margin:0 0 18px;font-family:${SERIF};font-size:26px;line-height:1.25;font-weight:600;color:${C.ink}">${esc(email.heading)}</h1>
            ${paragraphs}
            ${details}
            ${callout}
            ${closing}
            ${button}
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:18px 8px 0;font-size:12px;line-height:1.6;color:${C.soft};text-align:center">
        You're getting this because you have a New Normal Finance account.${appUrl ? `<br><a href="${esc(appUrl)}" style="color:${C.soft}">${esc(appUrl.replace(/^https?:\/\//, ""))}</a>` : ""}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    email.heading,
    ...email.paragraphs,
    ...(email.details?.length ? [email.details.map(([l, v]) => `${l}: ${v}`).join("\n")] : []),
    ...(email.callout ? [`${email.callout.label}: ${email.callout.text}`] : []),
    ...(email.closing ? [email.closing] : []),
    ...(href ? [`${email.link!.label}: ${href}`] : []),
    "You're getting this because you have a New Normal Finance account.",
  ].join("\n\n");

  return { html, text };
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
