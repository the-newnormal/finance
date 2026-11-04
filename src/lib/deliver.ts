import "server-only";

/** The longest an action waits for its emails before answering. */
export const DELIVER_TIMEOUT_MS = 15_000;

/**
 * Runs an action's emails before it answers, waiting at most 15 seconds, and never throws: the
 * decision is already saved, so a slow or failing mail server only means a missing email (logged
 * as a code), never a failed action.
 *
 * Not `after()`: emails scheduled to run after the response were never sent on Vercel (no "sent",
 * no error in the logs), while one sent before the response (the Account page's test) arrived. Mail
 * normally takes a second or two, so waiting for it is the reliable choice.
 */
export async function deliver(task: () => Promise<unknown>, ms = DELIVER_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      task(),
      new Promise((resolve) => { timer = setTimeout(() => { console.error("notify slow", { code: "timeout" }); resolve(null); }, ms); }),
    ]);
  } catch (e) {
    console.error("notify failed", { code: (e as { code?: string })?.code ?? "unknown" });
  } finally {
    clearTimeout(timer);
  }
}
