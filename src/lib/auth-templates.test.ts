import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Supabase's sign-in emails (pasted into the dashboard, and used by local Supabase). Their links
// must reach /auth/callback with the token, or nobody can sign in.
const template = (name: string) => readFileSync(new URL(`../../supabase/templates/${name}.html`, import.meta.url), "utf8");

describe("Supabase email templates", () => {
  it.each([["invite", "invite"], ["magic-link", "email"]])("%s links back with the token", (name, type) => {
    const html = template(name);
    const link = `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=${type}`;
    expect(html).toContain(`<a href="${link}"`);
    expect(html.match(/href="\{\{ \.RedirectTo \}\}[^"]*"/g)).toEqual([`href="${link}"`, `href="${link}"`]);
  });
});
