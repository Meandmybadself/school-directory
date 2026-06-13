// ULID generation — sortable, URL-safe, 26-char Crockford base32.
// Monotonic within the same millisecond to keep audit_log strictly ordered.

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32 (no I,L,O,U)
const TIME_LEN = 10;
const RAND_LEN = 16;

let lastTime = 0;
let lastRand: number[] = [];

function randomBytes(len: number): number[] {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b % 32);
}

function encodeTime(time: number): string {
  let out = "";
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = time % 32;
    out = ENCODING[mod] + out;
    time = (time - mod) / 32;
  }
  return out;
}

function incrementRand(rand: number[]): number[] {
  const out = rand.slice();
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i]! < 31) {
      out[i]!++;
      return out;
    }
    out[i] = 0;
  }
  return out; // overflow (astronomically unlikely); wraps
}

/** Generate a new ULID. Pass `now` only for deterministic tests. */
export function ulid(now: number = Date.now()): string {
  let rand: number[];
  if (now === lastTime) {
    rand = incrementRand(lastRand);
  } else {
    rand = randomBytes(RAND_LEN);
    lastTime = now;
  }
  lastRand = rand;
  return encodeTime(now) + rand.map((r) => ENCODING[r]).join("");
}
