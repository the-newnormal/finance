import { afterEach, describe, expect, it, vi } from "vitest";
import { deliver } from "./deliver";

afterEach(() => vi.useRealTimers());

describe("deliver", () => {
  it("waits for the emails", async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    await deliver(task);
    expect(task).toHaveBeenCalledOnce();
  });

  it("never throws, and logs only a code", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(deliver(() => Promise.reject(Object.assign(new Error("secret"), { code: "EAUTH" })))).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("notify failed", { code: "EAUTH" });
  });

  it("stops waiting after its time limit", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const done = deliver(() => new Promise(() => {}), 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(done).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("notify slow", { code: "timeout" });
  });
});
