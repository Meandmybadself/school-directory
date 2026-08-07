// GET /subscribe/confirm/:token — step two of double opt-in, shown.
// POST /subscribe/confirm/:token — step two, done.
//
// The split is not ceremony. Mail scanners, link-preview crawlers and "safe
// links" rewriters follow every GET in an email before the recipient sees it;
// if the GET completed the subscription, the confirmation would prove that the
// recipient's MAIL SERVER exists, which is not the question being asked. So the
// GET only reads, and a button the reader presses does the writing — the same
// reasoning, in reverse, that governs /unsubscribe/:token in the API.
//
// Every response here is no-store: the URL carries a single-use token and the
// body names an email address, neither of which may sit in a shared cache.

import { NEWSLETTER_WEB_CSS } from "@sd/shared";
import type {
  NewsletterBrandingDTO,
  PublicNewsletterBrandingDTO,
  PublicNewsletterConfirmationDTO,
} from "@sd/shared";
import { apiJson, apiPost, escapeHtml, htmlPrivate, shell, type PagesEnv } from "../../_lib/page.js";

const FALLBACK_BRANDING: NewsletterBrandingDTO = {
  newsletterTitle: "Newsletter",
  accentColor: "#0068A8",
  logoUrl: null,
  footerHtml: "",
  calendarUrl: "",
};

async function branding(env: PagesEnv): Promise<NewsletterBrandingDTO> {
  const data = await apiJson<PublicNewsletterBrandingDTO>(env, "/newsletter-public/branding");
  return data?.branding ?? FALLBACK_BRANDING;
}

function page(b: NewsletterBrandingDTO, origin: string, title: string, body: string): string {
  const inner = b.logoUrl
    ? `<img src="${escapeHtml(b.logoUrl)}" alt="${escapeHtml(b.newsletterTitle)}" />`
    : `<div class="nl-masthead-title">${escapeHtml(b.newsletterTitle)}</div>`;
  return shell({
    title: `${title} — ${b.newsletterTitle}`,
    description: `Confirm your ${b.newsletterTitle} subscription.`,
    // Never advertise the token URL as canonical — it is single-use and names an
    // address. Points at the form, which is the indexable page of this pair.
    canonical: `${origin}/subscribe`,
    accentColor: b.accentColor,
    css: NEWSLETTER_WEB_CSS,
    noindex: true,
    body: `    <div class="nl-wrap">
      <div class="nl-masthead"><a href="/" style="text-decoration:none">${inner}</a></div>
      <div class="nl-card">
${body}
      </div>
    </div>`,
  });
}

/** Shown for a token that is unknown, already used, or past its 7 days. All
 *  three are one message on purpose: the difference is only interesting to
 *  someone probing tokens, and "already used" is the common case anyway —
 *  a reader who clicks the link twice. */
function dead(): string {
  return `        <h1 class="nl-title">This link has expired</h1>
        <p class="nl-subtitle">Confirmation links are single-use and last seven days. It may also have
          already been used, in which case you're subscribed and there's nothing to do.</p>
        <p class="nl-hint"><a href="/subscribe">Request a new link</a> &middot; <a href="/">Back to past issues</a></p>`;
}

export const onRequestGet: PagesFunction<PagesEnv> = async (context) => {
  const origin = new URL(context.request.url).origin;
  const token = String(context.params.token ?? "");
  const b = await branding(context.env);

  const found = await apiJson<PublicNewsletterConfirmationDTO>(
    context.env,
    `/newsletter-public/subscribe/confirm/${encodeURIComponent(token)}`,
  );
  if (!found) return htmlPrivate(page(b, origin, "Link expired", dead()), 404);

  return htmlPrivate(
    page(
      b,
      origin,
      "Confirm your subscription",
      `        <h1 class="nl-title">One more tap</h1>
        <p class="nl-subtitle">Confirm that you want the ${escapeHtml(b.newsletterTitle)} sent to
          <strong>${escapeHtml(found.email)}</strong>.</p>
        <form class="nl-form" method="post" action="/subscribe/confirm/${escapeHtml(encodeURIComponent(token))}">
          <button class="nl-btn" type="submit">Yes, subscribe me</button>
          <p class="nl-hint">Didn't ask for this? Close this page — nothing has been added, and we
            won't email you again.</p>
        </form>`,
    ),
  );
};

export const onRequestPost: PagesFunction<PagesEnv> = async (context) => {
  const origin = new URL(context.request.url).origin;
  const token = String(context.params.token ?? "");
  const b = await branding(context.env);

  const res = await apiPost<{ ok: boolean; email: string }>(
    context.env,
    `/newsletter-public/subscribe/confirm/${encodeURIComponent(token)}`,
    {},
  );
  if (!res || res.status === 404) return htmlPrivate(page(b, origin, "Link expired", dead()), 404);
  if (res.status >= 400) {
    return htmlPrivate(
      page(
        b,
        origin,
        "Something went wrong",
        `        <h1 class="nl-title">That didn't go through</h1>
        <p class="nl-subtitle">We couldn't finish subscribing you just now.</p>
        <p class="nl-hint"><a href="/subscribe">Try again</a></p>`,
      ),
      502,
    );
  }

  const who = res.data?.email ?? "";
  return htmlPrivate(
    page(
      b,
      origin,
      "You're subscribed",
      `        <h1 class="nl-title">You're subscribed</h1>
        <p class="nl-subtitle">${who ? `${escapeHtml(who)} will get` : "You'll get"} the
          ${escapeHtml(b.newsletterTitle)} from now on.</p>
        <p class="nl-hint">Every issue has an unsubscribe link at the bottom, and you can stop any time.</p>
        <p class="nl-hint"><a href="/">Read past issues</a></p>`,
    ),
  );
};
