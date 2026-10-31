/** The longest email address there can be (RFC 5321). */
export const MAX_EMAIL_LENGTH = 254;

/**
 * Whether a string looks like an email address: one "@", something before it, and a domain with a
 * dot that isn't at either end, with no spaces. Checked in one pass, with no regular expression, so
 * a long crafted value from the public login form costs only its length (a pattern with overlapping
 * repeats around the dot could backtrack for seconds). Supabase decides whether it's a real account.
 */
export function isEmailAddress(value: string): boolean {
  if (value.length === 0 || value.length > MAX_EMAIL_LENGTH || /\s/.test(value)) return false;
  const at = value.indexOf("@");
  if (at < 1 || at !== value.lastIndexOf("@")) return false;
  const domain = value.slice(at + 1);
  const dot = domain.indexOf(".");
  return dot > 0 && !domain.endsWith(".");
}
