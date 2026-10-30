// Wiring: board ⇄ server, session probe, fullscreen, sign-in sheet.
//
// The board component renders and reacts; BoardSync owns the server (full
// state out on every act, poll in every few seconds); this file connects the
// two and decides who may write — a GET /me answering 200 is "this device can
// run the game", and a 401 anywhere later flips it back to watching.

import "./bingo-board.js";
import { api, ApiError } from "./lib/api.js";
import { BoardSync } from "./lib/sync.js";
import { createSigninSheet } from "./signin.js";
import type { BoardChangeDetail } from "./bingo-board.js";

const board = document.querySelector("bingo-board")!;
const container = document.querySelector(".container")!;
const sync = new BoardSync();
const signin = createSigninSheet();

sync.onremote = (state) => {
  board.marked = state.markedNumbers;
  board.current = state.currentNumber;
};
sync.onauthlost = () => {
  board.operable = false;
};
sync.onstatus = (ok) => {
  board.offline = !ok;
};

board.addEventListener("board-change", (e) => {
  const { marked, current } = (e as CustomEvent<BoardChangeDetail>).detail;
  sync.push({ markedNumbers: marked, currentNumber: current });
});
board.addEventListener("request-signin", () => signin.open());

// Tap anywhere that isn't a number or the letters: fullscreen, as the
// original. Best-effort — iPads without Fullscreen API still play fine.
container.addEventListener("request-fullscreen", () => {
  void container.requestFullscreen?.().catch(() => {});
});

// First paint: the live board for everyone, then the session probe decides
// whether this screen operates or watches. Failures leave an empty board and
// the offline note; the poll recovers it when the connection returns.
void (async () => {
  try {
    const state = await sync.load();
    board.marked = state.markedNumbers;
    board.current = state.currentNumber;
  } catch {
    board.offline = true;
  }
  try {
    await api.me();
    board.operable = true;
  } catch (err) {
    board.operable = false;
    // A 401 is the expected signed-out answer, not connectivity trouble.
    if (!(err instanceof ApiError)) board.offline = true;
  }
  sync.startPolling();
})();
