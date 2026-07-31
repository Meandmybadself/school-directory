// The deep sign-in stash.
//
// Worth its own tests because it stands in for a security control it must not
// become: the API's `returnTo` allowlist accepts ORIGINS only, deliberately, so
// this helper carries the path instead. If it ever accepted an absolute URL it
// would reintroduce exactly the open redirect that allowlist exists to prevent
// — hence the assertions on "//evil.example" and "https://…" below.

import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { rememberReturnPath, takeReturnPath } from "./returnPath.js";

/** Minimal sessionStorage, since these tests run under the node environment. */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

describe("returnPath", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = installStorage();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("round-trips a same-origin path", () => {
    rememberReturnPath("/v/fall-carnival-2026-10-17");
    expect(takeReturnPath()).toBe("/v/fall-carnival-2026-10-17");
  });

  it("is one-shot — a second read gets nothing", () => {
    rememberReturnPath("/v/carnival");
    expect(takeReturnPath()).toBe("/v/carnival");
    expect(takeReturnPath()).toBeNull();
    expect(store.size).toBe(0);
  });

  it("refuses an absolute URL, so it can't become an open redirect", () => {
    rememberReturnPath("https://evil.example/steal");
    expect(takeReturnPath()).toBeNull();
    expect(store.size).toBe(0);
  });

  it("refuses a protocol-relative URL, which a browser treats as absolute", () => {
    // "//evil.example" starts with a slash but navigates off-origin — the case
    // a naive `startsWith("/")` check would wave through if it ran only on read.
    rememberReturnPath("//evil.example/steal");
    expect(takeReturnPath()).toBeNull();
  });

  it("expires a stale stash rather than yanking someone off the agenda", () => {
    rememberReturnPath("/v/carnival");
    vi.advanceTimersByTime(31 * 60 * 1000);
    expect(takeReturnPath()).toBeNull();
  });

  it("keeps a stash that is still fresh", () => {
    rememberReturnPath("/v/carnival");
    vi.advanceTimersByTime(29 * 60 * 1000);
    expect(takeReturnPath()).toBe("/v/carnival");
  });

  it("returns null on a corrupt entry instead of throwing", () => {
    sessionStorage.setItem("sd_cal_return_path", "not json");
    expect(takeReturnPath()).toBeNull();
  });

  it("returns null when nothing was stashed", () => {
    expect(takeReturnPath()).toBeNull();
  });
});
