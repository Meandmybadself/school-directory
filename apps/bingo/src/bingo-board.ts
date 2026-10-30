// The board itself, ported from Meandmybadself/bingo-board. One deliberate
// change of shape: the component no longer persists anything. State arrives
// through `marked`/`current` (the server's answer, via main.ts) and every
// local act goes out as a `board-change` event — localStorage was the original
// app's store, and the server is this one's. When the viewer can't write
// (`operable` false), taps ask for a sign-in instead of changing the game.

import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import boardStyles from "./bingo-board.styles.js";
import { t } from "./lib/i18n.js";

const LETTERS = ["B", "I", "N", "G", "O"] as const;

const rangeForLetter = (letter: string): number[] => {
  const column = LETTERS.indexOf(letter as (typeof LETTERS)[number]);
  if (column === -1) return [];
  return Array.from({ length: 15 }, (_, i) => column * 15 + i + 1);
};

export const letterForNumber = (number: number): string =>
  LETTERS[Math.floor((number - 1) / 15)] ?? "";

export interface BoardChangeDetail {
  marked: number[];
  current: number | null;
}

@customElement("bingo-board")
export class BingoBoard extends LitElement {
  static override styles = boardStyles;

  /** Numbers called so far, in call order — the server's state, set by main.ts. */
  @property({ attribute: false })
  marked: number[] = [];

  /** The ball on display. */
  @property({ attribute: false })
  current: number | null = null;

  /** May this viewer run the game? False = watching (no session). */
  @property({ type: Boolean })
  operable = false;

  /** A write or poll is failing; show the offline note. */
  @property({ type: Boolean })
  offline = false;

  private _emitChange() {
    this.dispatchEvent(
      new CustomEvent<BoardChangeDetail>("board-change", {
        detail: { marked: this.marked, current: this.current },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _requestSignin() {
    this.dispatchEvent(new CustomEvent("request-signin", { bubbles: true, composed: true }));
  }

  /** Tap the letters column: new game (the original's reset gesture). */
  private _reset(e: MouseEvent) {
    e.stopPropagation();
    if (!this.operable) return this._requestSignin();
    this.marked = [];
    this.current = null;
    this._emitChange();
  }

  private _toggleNumber(number: number, e: MouseEvent) {
    e.stopPropagation();
    if (!this.operable) return this._requestSignin();
    const index = this.marked.indexOf(number);
    if (index > -1) {
      this.marked = [...this.marked.slice(0, index), ...this.marked.slice(index + 1)];
      if (this.current === number) this.current = null;
    } else {
      this.marked = [...this.marked, number];
      this.current = number;
    }
    this._emitChange();
  }

  override render() {
    return html`
      <div
        class="board"
        @click=${() => {
          this.dispatchEvent(new CustomEvent("request-fullscreen", { bubbles: true, composed: true }));
        }}
      >
        <ul role="button" class="letters" @click=${(e: MouseEvent) => this._reset(e)}>
          ${LETTERS.map((letter) => html`<li>${letter}</li>`)}
        </ul>
        <ul class="numbers">
          ${LETTERS.map(
            (letter) => html`<li>
              <ul>
                ${rangeForLetter(letter).map(
                  (number) =>
                    html`<li
                      class="number ${this.marked.includes(number) ? "marked" : ""} ${this.current === number
                        ? "last-clicked"
                        : ""}"
                      role="button"
                      @click=${(e: MouseEvent) => this._toggleNumber(number, e)}
                    >
                      ${number}
                    </li>`,
                )}
              </ul>
            </li>`,
          )}
        </ul>
        <div class="current">
          <div class="letter">${this.current === null ? "" : letterForNumber(this.current)}</div>
          <div class="number">${this.current ?? ""}</div>
        </div>
        ${this.offline
          ? html`<div class="chip offline">${t("bingoSyncError")}</div>`
          : this.operable
            ? nothing
            : html`<div
                class="chip"
                role="button"
                @click=${(e: MouseEvent) => {
                  e.stopPropagation();
                  this._requestSignin();
                }}
              >
                ${t("bingoViewOnly")}
              </div>`}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "bingo-board": BingoBoard;
  }
}
