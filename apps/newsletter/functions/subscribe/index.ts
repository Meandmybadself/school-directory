// GET /subscribe — the public sign-up form.  POST /subscribe — step one of
// double opt-in.
//
// Server-rendered here rather than added to src/app.tsx as an SPA route, for
// the reason in _lib/page.ts: this is reader-facing, linked from the archive
// index, and a stranger deciding whether to hand over their email address
// should not first download the ~590 kB authoring bundle. It also means the
// form is a plain <form> — it works with JavaScript off, and there is no
// fetch/CORS path to get wrong.
//
// Nothing here decides anything. The POST hands the address to the API's public
// subscribe route and renders whatever comes back, which is always the same
// neutral answer: the API will not say whether the address was already on the
// list (invariant 4), so neither can this page.

import { NEWSLETTER_WEB_CSS } from "@sd/shared";
import type { NewsletterBrandingDTO, PublicNewsletterBrandingDTO } from "@sd/shared";
import {
  apiJson,
  apiPost,
  escapeHtml,
  html,
  htmlPrivate,
  shell,
  type PagesEnv,
} from "../_lib/page.js";

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

function masthead(b: NewsletterBrandingDTO): string {
  const inner = b.logoUrl
    ? `<img src="${escapeHtml(b.logoUrl)}" alt="${escapeHtml(b.newsletterTitle)}" />`
    : `<div class="nl-masthead-title">${escapeHtml(b.newsletterTitle)}</div>`;
  return `<div class="nl-masthead"><a href="/" style="text-decoration:none">${inner}</a></div>`;
}

function page(b: NewsletterBrandingDTO, origin: string, body: string, title: string): string {
  return shell({
    title: `${title} — ${b.newsletterTitle}`,
    description: `Get the ${b.newsletterTitle} by email.`,
    canonical: `${origin}/subscribe`,
    accentColor: b.accentColor,
    css: NEWSLETTER_WEB_CSS,
    image: b.logoUrl,
    body: `    <div class="nl-wrap">
      ${masthead(b)}
      <div class="nl-card">
${body}
      </div>
    </div>`,
  });
}

function form(b: NewsletterBrandingDTO, error: string, value: string): string {
  return `        <h1 class="nl-title">Subscribe</h1>
        <p class="nl-subtitle">Get the ${escapeHtml(b.newsletterTitle)} in your inbox. Open to anyone — you don't need a directory account.</p>
        <form class="nl-form" method="post" action="/subscribe">
${error ? `          <p class="nl-error">${escapeHtml(error)}</p>` : ""}
          <label class="nl-label" for="email">Email address</label>
          <input class="nl-input" id="email" name="email" type="email" inputmode="email"
                 autocomplete="email" required placeholder="you@example.com"
                 value="${escapeHtml(value)}" />
          <div class="nl-hp" aria-hidden="true">
            <label for="website">Leave this field empty</label>
            <input id="website" name="website" type="text" tabindex="-1" autocomplete="off" />
          </div>
          <button class="nl-btn" type="submit">Send me a confirmation link</button>
          <p class="nl-hint">We'll email you a link to confirm. You're not subscribed until you
            click it, so nobody can sign you up using your address. Every issue has an
            unsubscribe link.</p>
        </form>`;
}

export const onRequestGet: PagesFunction<PagesEnv> = async (context) => {
  const origin = new URL(context.request.url).origin;
  const b = await branding(context.env);
  return html(page(b, origin, form(b, "", ""), "Subscribe"));
};

export const onRequestPost: PagesFunction<PagesEnv> = async (context) => {
  const origin = new URL(context.request.url).origin;
  const b = await branding(context.env);

  const data = await context.request.formData().catch(() => null);
  const email = String(data?.get("email") ?? "").trim();
  const honeypot = String(data?.get("website") ?? "").trim();

  // A filled honeypot is a bot. Render the same success page it would have got
  // anyway — telling it it was caught only teaches it to stop filling the field.
  if (honeypot) return htmlPrivate(page(b, origin, sent(email), "Check your email"));

  if (!email || !email.includes("@")) {
    return htmlPrivate(
      page(b, origin, form(b, "Enter an email address so we know where to send the link.", email), "Subscribe"),
      400,
    );
  }

  const res = await apiPost<{ ok: boolean }>(context.env, "/newsletter-public/subscribe", { email });
  if (!res || res.status >= 500) {
    return htmlPrivate(
      page(b, origin, form(b, "Something went wrong on our end. Please try again.", email), "Subscribe"),
      502,
    );
  }

  return htmlPrivate(page(b, origin, sent(email), "Check your email"));
};

/** The one answer the POST ever gives for a well-formed address — identical
 *  whether the address was new, already subscribed, or rate-limited. Saying
 *  anything more specific here would leak what the API refuses to. */
function sent(email: string): string {
  return `        <h1 class="nl-title">Check your email</h1>
        <p class="nl-subtitle">If ${escapeHtml(email)} can receive mail from us, a confirmation link is on its way.</p>
        <p class="nl-hint">Click the link in that email to finish subscribing — until then you're not on
          the list. If it hasn't arrived in a few minutes, check your spam folder.</p>
        <p class="nl-hint"><a href="/">Back to past issues</a></p>`;
}
