---
name: weekly-report
description: Build an HTML report of the past week of eisenhower.school activity — visits per site, top pages, referrers, sign-ups, access requests, volunteer sign-ups, newsletter sends, lost & found, store orders, edge health — compared with the week before. Use when asked for "the weekly report", "how was the site this week", "site activity", "traffic this week", or a recap of usage over the last N days.
---

# Weekly site activity report

The report holds production totals, so it is written OUTSIDE the repo — never commit
one.

## Run

```sh
node .claude/skills/weekly-report/report.mjs                      # last 7 full UTC days vs the 7 before
node .claude/skills/weekly-report/report.mjs --end 2026-10-03     # the 7 days ending (exclusive) on that date
node .claude/skills/weekly-report/report.mjs --days 14 --out ~/Desktop/report.html
node .claude/skills/weekly-report/report.mjs --json data.json     # also dump the raw numbers
```

Default output is `$TMPDIR/eisenhower-weekly-<start>.html`; pass `--out` into the
session scratchpad when there is one. The script prints the path and a one-line
summary. It needs `$CF_TOKEN` (Zone Analytics Read + Account Analytics Read) and a
wrangler login that can read the production D1 (read-only `SELECT`s only).

## Where the numbers come from

1. **Cloudflare Web Analytics** (account-level `rumPageloadEventsAdaptiveGroups`,
   filtered to `*eisenhower*` hosts — the account carries other sites too).
   Visits and page views per site, by day, top pages, referrers, devices, countries.
   Only HTML pages that run the injected beacon are counted; the API never is.
   `newsletter-eisenhower-school.translate.goog` is the translate proxy — real
   readers of the newsletter in another language.
2. **Cloudflare edge** (zone `eisenhower.school`): daily requests / page views /
   uniques / threats (`httpRequests1dGroups`), eyeball requests by host and status
   class (`httpRequestsAdaptiveGroups`). Hosts with a port (`:8080`, `:2082`…) are
   scanner noise and are reported as such.
   **Threats vs. blocked:** `threats` (1d groups) only says Cloudflare classified a
   request as suspicious. What a rule actually DID comes from `httpRequestsAdaptiveGroups`
   filtered `securityAction_neq:"unknown"` — action (block / challenge / log / skip) ×
   `securitySource` (managed WAF, browser integrity check, rate limit…), plus blocked per
   day, by site, by probed path and by country. It is sampled, so it differs slightly
   from `threats`. The free plan can't read `firewallEventsAdaptiveGroups`,
   `securityRuleId` or `clientAsn`, so no individual rule or network is named.
3. **Production D1**: `audit_log` by action (writes and sign-ins — reads are never
   audited), accounts, access queue, persons, volunteer sign-ups, newsletter
   sends/subscribers, lost & found, store orders, `read_budget`.

## Privacy rules for the report

The report is **aggregate-only**: no emails, names, IPs, person ids or user ids.
Page paths are normalized — ULIDs, `/persons/:id`, `/groups/:id`, `/o/:token`,
`/preview/:token` and any long opaque segment become placeholders — because a
review-link token or an order-status token in a path is a live capability
(invariants 15, 26). Newsletter titles and event slugs are already public. Keep it
that way when extending the script; if someone wants a name behind a number, look it
up in the terminal, don't put it in the page.

## After running

- Read the HTML before publishing it. Offer to publish it as a private Artifact
  (`icon: "chart"`); the page follows the artifact contract already (title, theme
  tokens, dark mode, phone width).
- In the reply: lead with 3–5 sentences on what moved week over week and anything
  under "Needs attention" (pending access requests, read-budget alerts, held lost &
  found items, failed newsletter sends, failed store fulfillment, a threats spike).
  Don't restate the whole report.
- If a query errors (schema changed, token scope), the script records it in the
  report's "Gaps" section rather than failing — mention any gaps.
