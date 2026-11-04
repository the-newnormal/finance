import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "@/lib/email";
import { sendTestEmail } from "./email-test-actions";

vi.mock("@/lib/session", () => ({ requireFinance: vi.fn(async () => ({ id: "me", email: "fin@normal.sg", name: "Fin Ance", role: "finance" })) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

beforeEach(() => {
  vi.mocked(sendEmail).mockReset();
  vi.useFakeTimers();
  vi.advanceTimersByTime(120_000); // past any earlier test's cooldown
});

describe("sendTestEmail", () => {
  it("sends to the signed-in Finance member only, and says so", async () => {
    vi.mocked(sendEmail).mockResolvedValue({ sent: true });
    expect(await sendTestEmail()).toEqual({ sent: true, to: "fin@normal.sg" });
    expect(sendEmail).toHaveBeenCalledWith("fin@normal.sg", expect.objectContaining({ subject: "Normal Finance test email" }));
  });

  it("explains the mail server's code", async () => {
    vi.mocked(sendEmail).mockResolvedValue({ sent: false, code: "EAUTH" });
    expect(await sendTestEmail()).toMatchObject({ sent: false, code: "EAUTH", hint: expect.stringContaining("app password") });
    vi.advanceTimersByTime(60_000);
    vi.mocked(sendEmail).mockResolvedValue({ sent: false, code: "smtp_not_configured" });
    expect(await sendTestEmail()).toMatchObject({ hint: expect.stringContaining("isn't set in Vercel") });
    vi.advanceTimersByTime(60_000);
    vi.mocked(sendEmail).mockResolvedValue({ sent: false, code: "EWHAT" });
    expect(await sendTestEmail()).toMatchObject({ code: "EWHAT", hint: expect.stringContaining("Check every SMTP_") });
  });

  it("sends at most one a minute", async () => {
    vi.mocked(sendEmail).mockResolvedValue({ sent: true });
    await sendTestEmail();
    expect(await sendTestEmail()).toMatchObject({ sent: false, code: "wait" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(await sendTestEmail()).toMatchObject({ sent: true });
  });
});
