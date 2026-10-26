/** How recently a member must have signed in to set or change their password. */
export const RECENT_SIGN_IN_SECONDS = 15 * 60;

type Claims = { amr?: unknown; iat?: number } | null | undefined;

/**
 * Whether the session's latest sign-in (the newest `amr` entry Supabase puts in the access token:
 * an emailed link, a password) was within the last 15 minutes. A refreshed token keeps its original
 * sign-in times, so an old session never counts as recent.
 */
export function recentlySignedIn(claims: Claims, now = Date.now() / 1000): boolean {
  const amr = Array.isArray(claims?.amr) ? (claims.amr as { timestamp?: unknown }[]) : [];
  const times = amr.map((a) => a?.timestamp).filter((t): t is number => typeof t === "number");
  if (!times.length) return false;
  return now - Math.max(...times) <= RECENT_SIGN_IN_SECONDS;
}
