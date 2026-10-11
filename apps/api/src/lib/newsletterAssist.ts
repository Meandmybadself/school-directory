// Workers AI assistance for the newsletter composer (POST /newsletter/issues/
// :id/assist): tighten a draft, or make editorial suggestions.
//
// Four decisions shape this file, and all four are about staying cheap and
// staying inside invariant 9's one-renderer story:
//
//   The model never emits document structure. The draft is flattened to
//   NUMBERED TEXT BLOCKS (every paragraph, heading and list item, in order) and
//   the model answers with replacement text per block index. Images, events
//   blocks and dividers are never sent and can never be touched; the document's
//   shape — which blocks exist, in what order, inside what lists — is ours, so
//   a derailed answer can at worst reword a block, never invent a node
//   `newsletterRender.ts` has no case for. The rebuilt document is run through
//   `sanitizeNewsletterDoc` anyway, because "can't by construction" is what
//   every past leak said too.
//
//   Inline formatting crosses as minimal Markdown — **bold**, *italic*,
//   ~~strike~~, [label](url) — and is parsed back by a parser that knows ONLY
//   those forms and emits only text, hardBreak and the four matching marks.
//   A `fontSize` mark inside a block the model rewrites does not survive; the
//   review sheet says so, and the author is looking at the result before it
//   lands. An unchanged block keeps its original nodes byte for byte.
//
//   The route never writes the issue. A rewrite becomes real only when the
//   author accepts it and the editor saves through the ordinary PATCH — which
//   is also why this route pushes no audit draft: the one thing it mutates is
//   the `ai_budget` counter, which is not an event any more than `read_budget`
//   is (invariant 32), and the accepted edit is audited by the PATCH's sitting.
//
//   Everything is bounded, because the model spends the account's Workers AI
//   allocation — 10,000 free neurons a day, SHARED with the lost & found's
//   vision model. Input is capped (MAX_DOC_CHARS), output is capped
//   (max_tokens), and `claimAssistBudget` caps how many assists one UTC day may
//   spend at all (DAILY_ASSIST_LIMIT, instance-wide). The binding itself is
//   optional in the absent-means-off sense every optional secret here has.

import type { NewsletterAssistChangeDTO, NewsletterNode } from "@sd/shared";
import { sanitizeNewsletterDoc } from "@sd/shared";
import type { Env } from "../env.js";
import { extractJson } from "./lostFound.js";

/** Same model the lost & found already runs (lib/lostFound.ts): a text-capable
 *  chat model whose JSON mode and thinking toggle this codebase has already
 *  calibrated, and a sparse model, so a call costs single-digit neurons rather
 *  than a 70B model's hundreds. Override per-instance with
 *  NEWSLETTER_ASSIST_MODEL. */
export const ASSIST_MODEL = "@cf/google/gemma-4-26b-a4b-it";

/** Upper bound on the draft text sent to the model, in characters (~5k
 *  tokens). Over it the route refuses rather than truncating — a rewrite of
 *  half a document would silently bless the other half unread. */
export const MAX_DOC_CHARS = 20_000;

/** Assists per UTC day, instance-wide. Sized against the free allocation: at
 *  the observed single-digit-to-tens neuron cost per call this spends at most
 *  a few hundred of the day's 10,000, leaving the bulk for the lost & found. */
export const DAILY_ASSIST_LIMIT = 20;

/** Ceilings on what the suggestions mode hands back, whatever the model says. */
const SUGGESTION_MAX = 8;
const SUGGESTION_MAX_CHARS = 500;

// ── Daily budget ─────────────────────────────────────────────────────────────

/**
 * Claim one assist from today's budget, or refuse.
 *
 * An atomic upsert whose DO UPDATE enforces the cap in its WHERE, read back
 * through `meta.changes` — invariant 13's idiom, because D1 has no
 * read-then-write transaction and two editors can click together. A refusal
 * writes nothing: unlike `read_budget`, where a retrying script should spend
 * its day, a refused call here cost no neurons, and neurons are what this
 * counts.
 */
export async function claimAssistBudget(env: Env, day: string): Promise<boolean> {
  const res = await env.DB.prepare(
    `INSERT INTO ai_budget (day, count) VALUES (?, 1)
     ON CONFLICT (day) DO UPDATE SET count = count + 1 WHERE count < ?`,
  )
    .bind(day, DAILY_ASSIST_LIMIT)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

// ── Document ⇄ text blocks ───────────────────────────────────────────────────

/** One block of prose the model may rewrite. `node` points INTO the document it
 *  was collected from, so replacing `node.content` edits that document. */
export interface TextSlot {
  node: NewsletterNode;
  kind: "heading" | "paragraph" | "list item" | "quote";
}

/**
 * Every rewritable block, in document order. Paragraphs and headings at any
 * depth; a list item's paragraphs count as "list item" and a blockquote's as
 * "quote", so the model knows what register it is editing. Images, events
 * blocks and rules are not collected — they are not prose, and not collecting
 * them is what makes them untouchable.
 */
export function collectTextSlots(doc: NewsletterNode): TextSlot[] {
  const slots: TextSlot[] = [];
  const walk = (node: NewsletterNode, kind: TextSlot["kind"]) => {
    switch (node.type) {
      case "heading":
        slots.push({ node, kind: "heading" });
        return;
      case "paragraph":
        slots.push({ node, kind });
        return;
      case "bulletList":
      case "orderedList":
        for (const li of node.content ?? []) walk(li, "list item");
        return;
      case "listItem":
        for (const child of node.content ?? []) walk(child, "list item");
        return;
      case "blockquote":
        for (const child of node.content ?? []) walk(child, "quote");
        return;
      case "doc":
        for (const child of node.content ?? []) walk(child, "paragraph");
        return;
      default:
        // image, eventsBlock, horizontalRule — nothing to rewrite.
        return;
    }
  };
  walk(doc, "paragraph");
  return slots;
}

/** A block's inline content as the minimal Markdown the prompts describe. The
 *  link wraps outermost, matching how `renderText` nests the real HTML. */
export function inlineToMarkdown(nodes: NewsletterNode[] | undefined): string {
  let out = "";
  for (const n of nodes ?? []) {
    if (n.type === "hardBreak") {
      out += "\n";
      continue;
    }
    if (n.type !== "text") {
      out += inlineToMarkdown(n.content);
      continue;
    }
    let text = n.text ?? "";
    if (!text) continue;
    const marks = n.marks ?? [];
    const has = (t: string) => marks.some((m) => m.type === t);
    if (has("strike")) text = `~~${text}~~`;
    if (has("italic")) text = `*${text}*`;
    if (has("bold")) text = `**${text}**`;
    const link = marks.find((m) => m.type === "link");
    const href = typeof link?.attrs?.href === "string" ? link.attrs.href : null;
    if (href) text = `[${text}](${href})`;
    out += text;
  }
  return out;
}

type InlineMark = { type: string; attrs?: Record<string, unknown> };

/** One Markdown form at a time, outermost first. Links take http(s) and mailto
 *  only — the two schemes `safeLinkHref` in the renderer will keep anyway. */
const INLINE_RE =
  /\[([^\]]+)\]\(((?:https?:|mailto:)[^\s)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|~~([^~]+)~~/;

/**
 * Parse the model's minimal Markdown back to inline nodes: text, hardBreak,
 * and the bold/italic/strike/link marks — nothing else can come out, whatever
 * came in. Unknown syntax is just text.
 */
export function markdownToInline(text: string, marks: InlineMark[] = []): NewsletterNode[] {
  const out: NewsletterNode[] = [];
  const pushText = (raw: string) => {
    const lines = raw.split("\n");
    lines.forEach((line, i) => {
      if (i > 0) out.push({ type: "hardBreak" });
      if (line) out.push(marks.length ? { type: "text", text: line, marks } : { type: "text", text: line });
    });
  };
  let rest = text;
  while (rest) {
    const m = INLINE_RE.exec(rest);
    if (!m) {
      pushText(rest);
      break;
    }
    if (m.index > 0) pushText(rest.slice(0, m.index));
    if (m[1] !== undefined) {
      out.push(...markdownToInline(m[1], [...marks, { type: "link", attrs: { href: m[2] } }]));
    } else if (m[3] !== undefined) {
      out.push(...markdownToInline(m[3], [...marks, { type: "bold" }]));
    } else if (m[4] !== undefined) {
      out.push(...markdownToInline(m[4], [...marks, { type: "italic" }]));
    } else if (m[5] !== undefined) {
      out.push(...markdownToInline(m[5], [...marks, { type: "strike" }]));
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

/** The user message both prompts share: numbered blocks, one per line. */
export function slotsToPrompt(slots: TextSlot[]): string {
  return slots
    .map((s, i) => `[${i}] ${s.kind}: ${inlineToMarkdown(s.node.content).replaceAll("\n", " / ")}`)
    .join("\n");
}

/** Characters of prose the prompt would carry — what MAX_DOC_CHARS bounds. */
export function slotsTextLength(slots: TextSlot[]): number {
  return slots.reduce((n, s) => n + inlineToMarkdown(s.node.content).length, 0);
}

// ── The two assists ──────────────────────────────────────────────────────────

const SUCCINCT_PROMPT = `You are an editor tightening a school newsletter written by parent volunteers for families.
The user message lists the draft's text blocks, one per line, as:
[index] kind: text
Inline formatting is minimal Markdown: **bold**, *italic*, ~~strike~~, [label](url).

Rewrite wordy blocks to be more succinct. Every fact must survive: names, dates, times, places, prices and amounts stay exactly as written, and every [label](url) link is kept with its url unchanged. Keep the writer's warm tone. Never merge, reorder, add or remove blocks, and never leave a block empty. Leave a block out of your answer entirely if it is already tight.

Answer with JSON only: {"blocks":[{"i":<index>,"text":"<rewritten block>"}]}`;

const SUGGESTIONS_PROMPT = `You are an experienced copy editor reviewing a school newsletter draft written by parent volunteers for families.
The user message lists the draft's text blocks, one per line, as:
[index] kind: text
Inline formatting is minimal Markdown: **bold**, *italic*, ~~strike~~, [label](url).

Give three to six short, specific, actionable editorial suggestions: clarity, ordering, a missing detail a family would need (a date, a time, a place, what to do), tone, reading level. Quote the draft where it helps the author find the spot. Do not rewrite the draft, do not pad the list, and do not comment on the spelling of people's names.

Answer with JSON only: {"suggestions":["<suggestion>", "..."]}`;

/** One call, mirroring lostFound's `describeOnce`: JSON mode (strict schema
 *  decoding derails this model — see that file), low temperature, thinking off
 *  (billed by the token), and a hard output cap. */
async function runModel(
  env: Env,
  system: string,
  user: string,
  maxTokens: number,
): Promise<Record<string, unknown>> {
  if (!env.AI) throw new Error("Workers AI is not bound");
  const model = env.NEWSLETTER_ASSIST_MODEL || ASSIST_MODEL;
  // The model id is configurable, so it can't be checked against the typed catalog.
  const run = env.AI.run.bind(env.AI) as (model: string, input: unknown) => Promise<unknown>;
  const result = await run(model, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    max_tokens: maxTokens,
    temperature: 0.2,
    chat_template_kwargs: { enable_thinking: false },
  });
  return extractJson(result);
}

/**
 * Tighten the draft. Returns the rebuilt, sanitized document and the per-block
 * before/after list, or null content when the model changed nothing.
 *
 * `doc` is cloned before anything touches it; replacements land on the clone's
 * slots, so an unchanged block is the original node, not a round-trip of it.
 * A replacement for an index that doesn't exist, an empty one, or one equal to
 * what is already there is ignored — the model may not empty a block or invent
 * a new one, only reword.
 */
export async function assistSuccinct(
  env: Env,
  doc: NewsletterNode,
): Promise<{ content: NewsletterNode | null; changes: NewsletterAssistChangeDTO[] }> {
  const copy = structuredClone(doc);
  const slots = collectTextSlots(copy);
  const json = await runModel(env, SUCCINCT_PROMPT, slotsToPrompt(slots), 3000);

  const raw = Array.isArray(json.blocks) ? (json.blocks as unknown[]) : [];
  const changes: NewsletterAssistChangeDTO[] = [];
  for (const entry of raw) {
    const e = entry as { i?: unknown; text?: unknown };
    const i = typeof e.i === "number" ? e.i : NaN;
    const text = typeof e.text === "string" ? e.text.trim() : "";
    const slot = Number.isInteger(i) ? slots[i] : undefined;
    if (!slot || !text) continue;
    const before = inlineToMarkdown(slot.node.content);
    // The prompt flattens a block's hard breaks to " / " to keep one block per
    // line, so an unchanged multi-line block can echo back in either spelling.
    if (text === before || text === before.replaceAll("\n", " / ")) continue;
    const inline = markdownToInline(text);
    if (inline.length === 0) continue;
    slot.node.content = inline;
    changes.push({ before, after: text });
  }
  if (changes.length === 0) return { content: null, changes: [] };

  // Belt as well as braces: the parser above can only emit allowed shapes, but
  // the stored-document allowlist is the one that decides (invariant 9).
  const content = sanitizeNewsletterDoc(copy);
  if (!content) return { content: null, changes: [] };
  return { content, changes };
}

/** Editorial notes. Advice only — nothing is rewritten, so there is nothing to
 *  apply and nothing to undo; dismissing the list is the whole lifecycle. */
export async function assistSuggestions(env: Env, doc: NewsletterNode): Promise<string[]> {
  const slots = collectTextSlots(doc);
  const json = await runModel(env, SUGGESTIONS_PROMPT, slotsToPrompt(slots), 900);
  const raw = Array.isArray(json.suggestions) ? (json.suggestions as unknown[]) : [];
  return raw
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, SUGGESTION_MAX)
    .map((s) => (s.length > SUGGESTION_MAX_CHARS ? `${s.slice(0, SUGGESTION_MAX_CHARS - 1)}…` : s));
}
