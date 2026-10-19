import { describe, expect, it } from "vitest";
import { DEFAULT_AFTER_LOGIN, safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  it("keeps same-site paths, including query and hash", () => {
    expect(safeNextPath("/claims")).toBe("/claims");
    expect(safeNextPath("/claims/new?pool=abc#receipt")).toBe(
      "/claims/new?pool=abc#receipt",
    );
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["absolute URL", "https://evil.example/claims"],
    ["protocol-relative", "//evil.example"],
    ["backslash trick", "/\\evil.example"],
    ["tab trick", "/\t/evil.example"],
    ["dot segment", "/.//evil.example"],
    ["double-dot segment", "/..//evil.example"],
    ["encoded dot segment", "/%2e//evil.example"],
    ["nested dot segment", "/a/..//evil.example"],
    ["javascript: URL", "javascript:alert(1)"],
    ["relative path", "claims"],
  ])("falls back for %s", (_label, input) => {
    expect(safeNextPath(input)).toBe(DEFAULT_AFTER_LOGIN);
  });

  it("uses a custom fallback when given", () => {
    expect(safeNextPath("//evil.example", "/login")).toBe("/login");
  });
});
