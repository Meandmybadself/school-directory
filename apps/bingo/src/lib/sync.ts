// Keeps the board and the server agreeing, both directions.
//
// Writes are full-state, last-write-wins (the server's model — see
// routes/bingo.ts), which makes retry trivially safe: whatever the newest
// local state is, push THAT, and a dropped write costs nothing. Reads poll
// the public GET every few seconds so a second screen — the one at the front
// of the gym, or a parent's phone — follows along without anyone refreshing.

import type { BingoStateDTO, BingoStateInput } from "@sd/shared";
import { api, ApiError } from "./api.js";

const POLL_MS = 4000;
const RETRY_MS = 3000;

export class BoardSync {
  /** The newest unpushed local state; null when the server is caught up. */
  private dirty: BingoStateInput | null = null;
  private pushing = false;
  private lastUpdatedAt: string | null = null;

  /** The server changed under us (someone else's screen wrote). */
  onremote: ((state: BingoStateDTO) => void) | null = null;
  /** A write came back 401 — the session is gone; the board goes view-only. */
  onauthlost: (() => void) | null = null;
  /** Connectivity, for the offline banner. */
  onstatus: ((ok: boolean) => void) | null = null;

  async load(): Promise<BingoStateDTO> {
    const { state } = await api.state();
    this.lastUpdatedAt = state.updatedAt;
    return state;
  }

  /** Queue the newest local state; pushes collapse to the latest. */
  push(state: BingoStateInput): void {
    this.dirty = state;
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.pushing) return;
    this.pushing = true;
    try {
      while (this.dirty) {
        const state = this.dirty;
        this.dirty = null;
        try {
          const res = await api.putState(state);
          this.lastUpdatedAt = res.state.updatedAt;
          this.onstatus?.(true);
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            // Not a connectivity problem: stop retrying and say so. The local
            // screen keeps what it shows; signing in starts a fresh page.
            this.onauthlost?.();
            return;
          }
          // Offline or a 5xx — keep the newest state (a tap that arrived while
          // we were failing wins over the one that failed) and retry.
          this.dirty = this.dirty ?? state;
          this.onstatus?.(false);
          await new Promise((r) => setTimeout(r, RETRY_MS));
        }
      }
    } finally {
      this.pushing = false;
    }
  }

  /** Poll for someone else's writes. Skipped while hidden (a projector tab is
   *  never hidden) and while our own write is in flight or queued — our local
   *  state is newer than anything the poll could fetch. */
  startPolling(): void {
    setInterval(() => void this.poll(), POLL_MS);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) void this.poll();
    });
  }

  private async poll(): Promise<void> {
    if (document.hidden || this.dirty || this.pushing) return;
    try {
      const { state } = await api.state();
      this.onstatus?.(true);
      if (state.updatedAt !== this.lastUpdatedAt) {
        this.lastUpdatedAt = state.updatedAt;
        this.onremote?.(state);
      }
    } catch {
      this.onstatus?.(false);
    }
  }
}
