#!/usr/bin/env node
// Weekly eisenhower.school activity report → one self-contained HTML file.
// Aggregates only: no emails, names, IPs or ids ever reach the page (see SKILL.md).
//
//   node report.mjs [--days 7] [--end YYYY-MM-DD] [--out file.html] [--json data.json]
//
// The window is [end - days, end) in whole UTC days; end defaults to today 00:00Z,
// so the default is the last seven COMPLETE days. The previous window of the same
// length is collected alongside for week-over-week deltas.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ZONE = "689f6323a55417c703d2b05b2c2aad31"; // eisenhower.school
const ACCOUNT = "c3b373ae8a90a6494e520f962bdf462b";
const DB = "school-directory";
// Hosts left out of the report entirely. The 1d zone totals can't filter by host, so
// the lines built from them (requests, uniques, data served, threats) still include
// these; every per-host, per-page and security figure excludes them.
const EXCLUDED_HOST = "demo.eisenhower.school";
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// ---------------------------------------------------------------- arguments
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, []),
);
const DAYS = Number(args.days ?? 7);
if (!Number.isInteger(DAYS) || DAYS < 1 || DAYS > 31) throw new Error("--days must be 1..31");
const day = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const today = new Date(day(new Date()) + "T00:00:00Z");
const END = args.end ? new Date(args.end + "T00:00:00Z") : today;
if (Number.isNaN(END.getTime())) throw new Error("--end must be YYYY-MM-DD");
const START = addDays(END, -DAYS);
const PREV = addDays(START, -DAYS);
const iso = (d) => d.toISOString();
const [S, E, P] = [iso(START), iso(END), iso(PREV)];
const OUT = resolve(args.out ?? join(tmpdir(), `eisenhower-weekly-${day(START)}.html`));
const days = Array.from({ length: DAYS }, (_, i) => day(addDays(START, i)));
const isCurrent = END.getTime() === today.getTime();

const fmtDay = (d, o = { month: "short", day: "numeric" }) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
const gaps = [];
const safe = async (label, fn, fallback) => {
  try {
    return await fn();
  } catch (e) {
    gaps.push(`${label}: ${String(e.message ?? e).slice(0, 200)}`);
    return fallback;
  }
};

// ---------------------------------------------------------------- Cloudflare
const token = process.env.CF_TOKEN;
async function gql(query, variables) {
  if (!token) throw new Error("CF_TOKEN not set");
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors?.length) throw new Error(j.errors.map((e) => e.message).join("; "));
  return j.data.viewer;
}
const zoneQ = (body) =>
  gql(`query($z:String!,$s:Time!,$e:Time!,$ds:Date!,$de:Date!){viewer{zones(filter:{zoneTag:$z}){${body}}}}`, {
    z: ZONE, s: S, e: E, ds: day(PREV), de: day(END),
  }).then((v) => v.zones[0]);
const rumQ = (body, s = S, e = E) =>
  gql(`query($a:String!,$s:Time!,$e:Time!){viewer{accounts(filter:{accountTag:$a}){${body}}}}`, {
    a: ACCOUNT, s, e,
  }).then((v) => v.accounts[0]);
const RUM_F = `filter:{datetime_geq:$s,datetime_lt:$e,requestHost_like:"%eisenhower%",requestHost_notlike:"${EXCLUDED_HOST}%"}`;

const edge = await safe("Cloudflare edge", async () => {
  const z = await zoneQ(`
    daily:httpRequests1dGroups(limit:62,filter:{date_geq:$ds,date_lt:$de},orderBy:[date_ASC]){
      dimensions{date} sum{requests pageViews threats bytes countryMap{clientCountryName requests}} uniq{uniques}}
    hosts:httpRequestsAdaptiveGroups(limit:500,filter:{datetime_geq:$s,datetime_lt:$e,requestSource:"eyeball",clientRequestHTTPHost_notlike:"${EXCLUDED_HOST}%"},orderBy:[count_DESC]){
      count dimensions{clientRequestHTTPHost}}
    status:httpRequestsAdaptiveGroups(limit:100,filter:{datetime_geq:$s,datetime_lt:$e,requestSource:"eyeball",clientRequestHTTPHost_notlike:"${EXCLUDED_HOST}%"},orderBy:[count_DESC]){
      count dimensions{edgeResponseStatus}}`);
  return z;
}, null);

// What the edge actually DID about a request. `threats` in the 1d groups only says a
// request was classified as one; `securityAction` (anything but "unknown") says a rule
// acted on it — block, challenge, … — and `securitySource` says which kind of rule.
// The firewall-events dataset would name the rule, but the free plan can't read it.
const SEC_F = (from, to) => `filter:{datetime_geq:${from},datetime_lt:${to},securityAction_neq:"unknown",clientRequestHTTPHost_notlike:"${EXCLUDED_HOST}%"}`;
const security = await safe("Cloudflare security actions", async () => {
  const z = await gql(
    `query($z:String!,$p:Time!,$s:Time!,$e:Time!){viewer{zones(filter:{zoneTag:$z}){
      actions:httpRequestsAdaptiveGroups(limit:50,${SEC_F("$s", "$e")},orderBy:[count_DESC]){count dimensions{securityAction securitySource}}
      prev:httpRequestsAdaptiveGroups(limit:50,${SEC_F("$p", "$s")},orderBy:[count_DESC]){count dimensions{securityAction}}
      daily:httpRequestsAdaptiveGroups(limit:500,${SEC_F("$s", "$e")},orderBy:[date_ASC]){count dimensions{date securityAction}}
      hosts:httpRequestsAdaptiveGroups(limit:100,${SEC_F("$s", "$e")},orderBy:[count_DESC]){count dimensions{clientRequestHTTPHost}}
      paths:httpRequestsAdaptiveGroups(limit:200,${SEC_F("$s", "$e")},orderBy:[count_DESC]){count dimensions{clientRequestPath}}
      countries:httpRequestsAdaptiveGroups(limit:50,${SEC_F("$s", "$e")},orderBy:[count_DESC]){count dimensions{clientCountryName}}}}}`,
    { z: ZONE, p: P, s: S, e: E },
  );
  return z.zones[0];
}, null);

const rum = await safe("Web Analytics", async () => {
  const cur = await rumQ(`
    hosts:rumPageloadEventsAdaptiveGroups(limit:100,${RUM_F},orderBy:[count_DESC]){count sum{visits} dimensions{requestHost}}
    daily:rumPageloadEventsAdaptiveGroups(limit:200,${RUM_F},orderBy:[date_ASC]){count sum{visits} dimensions{date}}
    paths:rumPageloadEventsAdaptiveGroups(limit:500,${RUM_F},orderBy:[count_DESC]){count sum{visits} dimensions{requestHost requestPath}}
    refs:rumPageloadEventsAdaptiveGroups(limit:200,${RUM_F},orderBy:[count_DESC]){count sum{visits} dimensions{refererHost}}
    devices:rumPageloadEventsAdaptiveGroups(limit:20,${RUM_F},orderBy:[count_DESC]){count sum{visits} dimensions{deviceType}}
    countries:rumPageloadEventsAdaptiveGroups(limit:50,${RUM_F},orderBy:[count_DESC]){count sum{visits} dimensions{countryName}}`);
  const prev = await rumQ(
    `hosts:rumPageloadEventsAdaptiveGroups(limit:100,${RUM_F},orderBy:[count_DESC]){count sum{visits} dimensions{requestHost}}`,
    P, S,
  );
  return { ...cur, prevHosts: prev.hosts };
}, null);

// ---------------------------------------------------------------- D1
// Every value interpolated below is an ISO date this script generated, never input.
const Sd = day(START), Ed = day(END);
const inCur = (c) => `COALESCE(${c} >= '${S}' AND ${c} < '${E}', 0)`;
const inPrev = (c) => `COALESCE(${c} >= '${P}' AND ${c} < '${S}', 0)`;
const QUERIES = {
  auditCur: `SELECT action, COUNT(*) n FROM audit_log WHERE ${inCur("created_at")} GROUP BY action`,
  auditPrev: `SELECT action, COUNT(*) n FROM audit_log WHERE ${inPrev("created_at")} GROUP BY action`,
  auditDaily: `SELECT substr(created_at,1,10) d, COUNT(*) n FROM audit_log WHERE ${inCur("created_at")} GROUP BY d`,
  signinUsers: `SELECT COUNT(DISTINCT CASE WHEN ${inCur("created_at")} THEN COALESCE(actor_user_id, entity_id) END) cur,
                       COUNT(DISTINCT CASE WHEN ${inPrev("created_at")} THEN COALESCE(actor_user_id, entity_id) END) prev
                  FROM audit_log WHERE action = 'auth.signin' AND created_at >= '${P}' AND created_at < '${E}'`,
  active: `SELECT COUNT(DISTINCT user_id) n FROM session WHERE acting_admin_id IS NULL AND last_seen_at >= '${S}'`,
  accounts: `SELECT COUNT(*) total, SUM(disabled_at IS NULL) enabled,
                    SUM(access_approved_at IS NOT NULL AND disabled_at IS NULL) approved,
                    SUM(access_submitted_at IS NOT NULL AND access_approved_at IS NULL AND access_declined_at IS NULL AND disabled_at IS NULL) pending,
                    SUM(${inCur("created_at")}) newCur, SUM(${inPrev("created_at")}) newPrev,
                    SUM(${inCur("access_approved_at")}) approvedCur
               FROM user`,
  persons: `SELECT COUNT(*) total, SUM(${inCur("created_at")}) cur, SUM(${inPrev("created_at")}) prev FROM person`,
  volunteer: `SELECT SUM(${inCur("created_at")}) cur, SUM(${inPrev("created_at")}) prev FROM volunteer_signup`,
  sheets: `SELECT s.slug, s.occurrence_start, SUM(p.slots) slots,
                  (SELECT COUNT(*) FROM volunteer_signup v JOIN volunteer_position vp ON vp.id = v.position_id WHERE vp.sheet_id = s.id) filled
             FROM volunteer_sheet s JOIN volunteer_position p ON p.sheet_id = s.id
            WHERE s.published_at IS NOT NULL AND s.occurrence_start >= '${E}'
            GROUP BY s.id ORDER BY s.occurrence_start LIMIT 12`,
  issues: `SELECT i.title, i.slug, i.sent_at, i.recipient_total,
                  (SELECT COUNT(*) FROM newsletter_send x WHERE x.issue_id = i.id AND x.status = 'sent') sent,
                  (SELECT COUNT(*) FROM newsletter_send x WHERE x.issue_id = i.id AND x.status = 'failed') failed
             FROM newsletter_issue i WHERE ${inCur("i.sent_at")} ORDER BY i.sent_at`,
  subscribers: `SELECT SUM(unsubscribed_at IS NULL AND confirmed_at IS NOT NULL) confirmed,
                       SUM(unsubscribed_at IS NULL) active,
                       SUM(${inCur("confirmed_at")}) newCur, SUM(${inPrev("confirmed_at")}) newPrev,
                       SUM(${inCur("unsubscribed_at")}) unsubCur
                  FROM newsletter_subscriber`,
  optOuts: `SELECT SUM(${inCur("newsletter_opt_out_at")}) cur FROM user`,
  lostfound: `SELECT SUM(${inCur("found_at")}) foundCur, SUM(${inPrev("found_at")}) foundPrev,
                     SUM(${inCur("returned_at")}) returnedCur,
                     SUM(status = 'found' AND hidden_at IS NULL AND held_at IS NULL) listed,
                     SUM(status = 'found' AND hidden_at IS NULL AND held_at IS NOT NULL) held,
                     SUM(status = 'found' AND tag_status = 'failed') tagFailed
                FROM lf_item`,
  claims: `SELECT SUM(${inCur("created_at")}) cur, SUM(${inPrev("created_at")}) prev, SUM(resolved_at IS NULL) open FROM lf_claim`,
  store: `SELECT SUM(${inCur("paid_at")}) paidCur, SUM(CASE WHEN ${inCur("paid_at")} THEN total_cents END) centsCur,
                 SUM(${inPrev("paid_at")}) paidPrev, SUM(CASE WHEN ${inPrev("paid_at")} THEN total_cents END) centsPrev,
                 SUM(${inCur("shipped_at")}) shippedCur, SUM(${inCur("created_at")} AND status IN ('awaiting_payment','abandoned')) unpaidCur,
                 SUM(status = 'fulfillment_failed') failed
            FROM store_order`,
  readBudget: `SELECT COUNT(DISTINCT user_id) users, SUM(reads) reads, MAX(reads) maxReads, SUM(alerted_at IS NOT NULL) alerts
                 FROM read_budget WHERE day >= '${Sd}' AND day < '${Ed}'`,
};
function d1(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", DB, "--remote", "--env", "production", "--json", "--command", sql],
    { cwd: join(REPO, "apps/api"), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 << 20 },
  );
  return JSON.parse(out);
}
const db = {};
{
  const names = Object.keys(QUERIES);
  try {
    // One round trip for everything; on failure, fall back to one call per query
    // so a single broken statement becomes one gap instead of an empty section.
    const res = d1(names.map((n) => QUERIES[n]).join(";\n"));
    names.forEach((n, i) => (db[n] = res[i].results));
  } catch {
    for (const n of names) {
      try {
        db[n] = d1(QUERIES[n])[0].results;
      } catch (e) {
        const msg = String(e.stderr || e.stdout || e.message).match(/\[ERROR\][^\n]*|error[^\n]*/i)?.[0] ?? "failed";
        gaps.push(`D1 ${n}: ${msg.slice(0, 200)}`);
        db[n] = null;
      }
    }
  }
}
const one = (n) => db[n]?.[0] ?? {};

// ---------------------------------------------------------------- shaping
const SITE_LABELS = {
  "eisenhower.school": "Front door",
  "www.eisenhower.school": "Front door (www)",
  "directory.eisenhower.school": "Directory",
  "calendar.eisenhower.school": "Calendar",
  "newsletter.eisenhower.school": "Newsletter",
  "newsletter-eisenhower-school.translate.goog": "Newsletter (translated)",
  "store.eisenhower.school": "Store",
  "pto.eisenhower.school": "PTO",
  "lostandfound.eisenhower.school": "Lost & found",
  "api-directory.eisenhower.school": "API",
  "ptomeet.eisenhower.school": "PTO Meet redirect",
};
const label = (h) => SITE_LABELS[h] ?? h;

// Paths can carry capabilities (review-link and order-status tokens) and ids.
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
function normPath(p) {
  const seg = (p || "/").split("?")[0].split("/");
  return seg
    .map((s, i) => {
      const prev = seg[i - 1];
      if (["persons", "groups", "people", "users"].includes(prev) && s) return ":id";
      if (["o", "preview", "callback", "confirm", "unsubscribe", "t"].includes(prev) && s) return ":token";
      if (ULID.test(s)) return ":id";
      if (s.length >= 24 && !s.includes("-")) return ":token";
      return s;
    })
    .join("/") || "/";
}

const sumBy = (rows, key, val) => {
  const m = new Map();
  for (const r of rows ?? []) m.set(key(r), (m.get(key(r)) ?? 0) + val(r));
  return m;
};

const rumHostsCur = sumBy(rum?.hosts, (r) => r.dimensions.requestHost, (r) => r.sum.visits);
const rumViewsCur = sumBy(rum?.hosts, (r) => r.dimensions.requestHost, (r) => r.count);
const rumHostsPrev = sumBy(rum?.prevHosts, (r) => r.dimensions.requestHost, (r) => r.sum.visits);
const edgeHostsAll = sumBy(edge?.hosts, (r) => r.dimensions.clientRequestHTTPHost, (r) => r.count);
let portNoise = 0;
const edgeHosts = new Map();
for (const [h, n] of edgeHostsAll) {
  if (/:\d+$/.test(h)) portNoise += n;
  else edgeHosts.set(h, n);
}
const siteRows = [...new Set([...rumHostsCur.keys(), ...rumHostsPrev.keys(), ...edgeHosts.keys()])]
  .map((h) => ({
    host: h,
    label: label(h),
    visits: rumHostsCur.get(h) ?? 0,
    views: rumViewsCur.get(h) ?? 0,
    prevVisits: rumHostsPrev.get(h) ?? 0,
    edge: edgeHosts.get(h) ?? 0,
  }))
  .sort((a, b) => b.visits - a.visits || b.edge - a.edge);

const visitsDaily = sumBy(rum?.daily, (r) => r.dimensions.date, (r) => r.sum.visits);
const viewsDaily = sumBy(rum?.daily, (r) => r.dimensions.date, (r) => r.count);
const totalVisits = [...rumHostsCur.values()].reduce((a, b) => a + b, 0);
const totalViews = [...rumViewsCur.values()].reduce((a, b) => a + b, 0);
const prevVisits = [...rumHostsPrev.values()].reduce((a, b) => a + b, 0);

const pages = [...sumBy(rum?.paths, (r) => `${r.dimensions.requestHost}${normPath(r.dimensions.requestPath)}`, (r) => r.count)]
  .map(([k, views]) => ({ k, views }))
  .sort((a, b) => b.views - a.views)
  .slice(0, 15);
const refs = [...sumBy(rum?.refs, (r) => r.dimensions.refererHost || "(direct / app)", (r) => r.sum.visits)]
  .filter(([k]) => !/eisenhower\.school$/.test(k))
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);
const devices = [...sumBy(rum?.devices, (r) => r.dimensions.deviceType || "unknown", (r) => r.sum.visits)].sort((a, b) => b[1] - a[1]);
const countries = [...sumBy(rum?.countries, (r) => r.dimensions.countryName || "??", (r) => r.sum.visits)].sort((a, b) => b[1] - a[1]).slice(0, 8);

const edgeDaily = (edge?.daily ?? []).map((r) => ({ date: r.dimensions.date, ...r.sum, uniques: r.uniq.uniques }));
const edgeCur = edgeDaily.filter((r) => r.date >= Sd && r.date < Ed);
const edgePrev = edgeDaily.filter((r) => r.date < Sd);
const tot = (rows, k) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
const SEC_SOURCE = {
  firewallManaged: "Managed rules (WAF)", firewallCustom: "Custom rules", bic: "Browser integrity check",
  securityLevel: "Security level (IP reputation)", hot: "Hotlink protection", ratelimit: "Rate limiting",
  botFight: "Bot fight mode", l7ddos: "DDoS protection", validation: "Request validation", uaBlock: "User-agent block",
  zoneLockdown: "Zone lockdown", country: "Country rule", ip: "IP access rule", ipRange: "IP access rule", asn: "ASN rule",
};
const SEC_ACTION = { block: "Blocked", challenge: "Challenged", managed_challenge: "Challenged (managed)", jschallenge: "Challenged (JS)", log: "Logged only", skip: "Skipped", allow: "Allowed by rule" };
const secActions = (security?.actions ?? [])
  .map((r) => ({ action: r.dimensions.securityAction, source: r.dimensions.securitySource, n: r.count }))
  .sort((a, b) => b.n - a.n);
const secByAction = sumBy(security?.actions, (r) => r.dimensions.securityAction, (r) => r.count);
const secPrevByAction = sumBy(security?.prev, (r) => r.dimensions.securityAction, (r) => r.count);
const blockedCur = secByAction.get("block") ?? 0, blockedPrev = secPrevByAction.get("block") ?? 0;
const secDays = sumBy((security?.daily ?? []).filter((r) => r.dimensions.securityAction === "block"), (r) => r.dimensions.date, (r) => r.count);
const secHosts = [...sumBy(security?.hosts, (r) => r.dimensions.clientRequestHTTPHost.replace(/:\d+$/, " (odd port)"), (r) => r.count)]
  .map(([h, n]) => [h.endsWith("(odd port)") ? h : label(h), n])
  .sort((a, b) => b[1] - a[1]).slice(0, 8);
const secPaths = [...sumBy(security?.paths, (r) => normPath(r.dimensions.clientRequestPath), (r) => r.count)].sort((a, b) => b[1] - a[1]).slice(0, 12);
const secCountries = [...sumBy(security?.countries, (r) => r.dimensions.clientCountryName || "??", (r) => r.count)].sort((a, b) => b[1] - a[1]).slice(0, 8);
const statusClasses = [...sumBy(edge?.status, (r) => `${String(r.dimensions.edgeResponseStatus)[0]}xx`, (r) => r.count)].sort();

const auditCur = new Map((db.auditCur ?? []).map((r) => [r.action, r.n]));
const auditPrev = new Map((db.auditPrev ?? []).map((r) => [r.action, r.n]));
const areaOf = (a) => (a.startsWith("volunteer") ? "Volunteers" : a.startsWith("lostfound") ? "Lost & found"
  : a.startsWith("newsletter") ? "Newsletter" : a.startsWith("calendar") ? "Calendar" : a.startsWith("pto") ? "PTO boards"
  : a.startsWith("store") ? "Store" : /^(auth|access|invite|control|masquerade)\./.test(a) ? "Accounts & access" : "Directory");
const actions = [...new Set([...auditCur.keys(), ...auditPrev.keys()])]
  .map((a) => ({ action: a, area: areaOf(a), cur: auditCur.get(a) ?? 0, prev: auditPrev.get(a) ?? 0 }))
  .sort((x, y) => x.area.localeCompare(y.area) || y.cur - x.cur);
const writesCur = tot([...auditCur.values()].map((n) => ({ n })), "n");
const writesPrev = tot([...auditPrev.values()].map((n) => ({ n })), "n");
const auditDaily = new Map((db.auditDaily ?? []).map((r) => [r.d, r.n]));

const acc = one("accounts"), per = one("persons"), vol = one("volunteer"), subs = one("subscribers");
const lf = one("lostfound"), cl = one("claims"), st = one("store"), rb = one("readBudget"), si = one("signinUsers");
const issues = db.issues ?? [];

// ---------------------------------------------------------------- attention
const attention = [];
if (acc.pending > 0) attention.push(["warn", `${acc.pending} access request${acc.pending > 1 ? "s" : ""} waiting for review`, "directory.eisenhower.school/admin"]);
if (rb.alerts > 0) attention.push(["crit", `${rb.alerts} read-budget alert${rb.alerts > 1 ? "s" : ""} (an account hit the read limit)`, null]);
if (lf.held > 0) attention.push(["warn", `${lf.held} lost & found item${lf.held > 1 ? "s" : ""} held for review`, "lostandfound.eisenhower.school"]);
if (lf.tagFailed > 0) attention.push(["warn", `${lf.tagFailed} lost & found description${lf.tagFailed > 1 ? "s" : ""} failed`, null]);
if (cl.open > 0) attention.push(["info", `${cl.open} open lost & found claim${cl.open > 1 ? "s" : ""}`, null]);
const failedSends = issues.reduce((a, i) => a + (i.failed ?? 0), 0);
if (failedSends > 0) attention.push(["crit", `${failedSends} newsletter email${failedSends > 1 ? "s" : ""} failed to send`, null]);
if (st.failed > 0) attention.push(["crit", `${st.failed} store order${st.failed > 1 ? "s" : ""} failed fulfillment`, null]);
const threatsCur = tot(edgeCur, "threats"), threatsPrev = tot(edgePrev, "threats");
// A day well above the week's typical blocked count, named with where it hit.
const blockedMedian = [...secDays].map(([, n]) => n).sort((a, b) => a - b)[Math.floor(secDays.size / 2)] ?? 0;
for (const [d, n] of secDays) {
  if (n > 1000 && n > blockedMedian * 5) {
    attention.push(["info", `Blocked ${fmt(n)} requests on ${fmtDay(d, { weekday: "short", month: "short", day: "numeric" })} (the week's typical day: ${fmt(blockedMedian)}). Top source country this week: ${secCountries[0]?.[0] ?? "?"}`, null]);
  }
}
const nonBlock = secActions.filter((a) => a.action !== "block").reduce((s, a) => s + a.n, 0);
if (gaps.length) attention.push(["warn", `${gaps.length} data source${gaps.length > 1 ? "s" : ""} could not be read (see Gaps)`, null]);

// ---------------------------------------------------------------- rendering
function fmt(n) {
  return n == null ? "–" : Number(n).toLocaleString("en-US");
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (c) => (c == null ? "–" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
function delta(cur, prev, upIsBad = false) {
  if (cur == null || prev == null) return "";
  if (prev === 0 && cur === 0) return `<span class="d flat">no change</span>`;
  if (prev === 0) return `<span class="d up">new</span>`;
  const p = Math.round(((cur - prev) / prev) * 100);
  const cls = p === 0 ? "flat" : (p > 0) !== upIsBad ? "up" : "down";
  return `<span class="d ${cls}" title="previous: ${fmt(prev)}">${p > 0 ? "▲" : p < 0 ? "▼" : "•"} ${Math.abs(p)}%</span>`;
}
const tile = (k, v, cur, prev, note = "") =>
  `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="n">${delta(cur, prev)}${note ? ` <span>${note}</span>` : ""}</div></div>`;

// Single-series daily bar chart, one scale for bars, ticks and labels.
function bars(values, { unit, title }) {
  const W = 640, H = 200, L = 44, R = 8, T = 12, B = 28;
  const max = Math.max(1, ...values.map((v) => v.y));
  const step = 10 ** Math.floor(Math.log10(max));
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => max / s <= 4) ?? step * 10;
  const top = Math.ceil(max / nice) * nice;
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const bw = (W - L - R) / values.length;
  const ticks = [];
  for (let t = 0; t <= top; t += nice) ticks.push(t);
  return `<figure class="chart" role="img" aria-label="${esc(title)}">
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join("")}
    ${values.map((v, i) => {
      const x = L + i * bw + bw * 0.18, w = bw * 0.64, h = Math.max(0, y(0) - y(v.y));
      const r = Math.min(4, h / 2, w / 2);
      const path = h > 0 ? `M${x},${y(0)} V${y(v.y) + r} Q${x},${y(v.y)} ${x + r},${y(v.y)} H${x + w - r} Q${x + w},${y(v.y)} ${x + w},${y(v.y) + r} V${y(0)} Z` : "";
      return `<g class="bar"><rect class="hit" x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}" fill="transparent"/>${path ? `<path d="${path}"/>` : ""}
        <text class="ax" x="${x + w / 2}" y="${H - 9}" text-anchor="middle">${esc(v.label)}</text>
        <text class="val" x="${x + w / 2}" y="${y(v.y) - 5}" text-anchor="middle">${fmt(v.y)}</text>
        <title>${esc(v.full)}: ${fmt(v.y)} ${unit}</title></g>`;
    }).join("")}
  </svg></figure>`;
}
const table = (head, rows, cls = "") =>
  `<div class="tw"><table class="${cls}"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${
    rows.length ? rows.join("") : `<tr><td colspan="${head.length}" class="empty">Nothing this week</td></tr>`
  }</tbody></table></div>`;
const share = (n, total) => `<span class="meter"><i style="width:${total ? Math.round((n / total) * 100) : 0}%"></i></span>`;

const rangeLabel = `${fmtDay(Sd)} – ${fmtDay(day(addDays(END, -1)), { month: "short", day: "numeric", year: "numeric" })}`;
const visitBars = days.map((d) => ({ y: visitsDaily.get(d) ?? 0, label: fmtDay(d, { weekday: "short" }), full: fmtDay(d, { weekday: "long", month: "short", day: "numeric" }) }));
const blockedBars = days.map((d) => ({ y: secDays.get(d) ?? 0, label: fmtDay(d, { weekday: "short" }), full: fmtDay(d, { weekday: "long", month: "short", day: "numeric" }) }));
const writeBars = days.map((d) => ({ y: auditDaily.get(d) ?? 0, label: fmtDay(d, { weekday: "short" }), full: fmtDay(d, { weekday: "long", month: "short", day: "numeric" }) }));
const totalDevices = devices.reduce((a, [, n]) => a + n, 0);
const totalCountries = countries.reduce((a, [, n]) => a + n, 0);

const html = `<title>Eisenhower Weekly Activity</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=Spline+Sans+Mono:wght@400;600&display=swap">
<style>
/* Layout: one reading column; summary tiles, then a two-up grid of sections that stacks on a phone.
   Palette and faces are the directory's own (apps/web/src/styles/tokens.css). */
:root {
  --bg: #f3f5f7; --paper: #ffffff; --ink: #19232e; --ink-2: #56636f; --ink-3: #8693a0;
  --line: #e7eaed; --blue: #0068a8; --blue-700: #00568c; --blue-tint: #e6f1f9;
  --orange: #faab1c; --orange-ink: #8a5500; --orange-tint: #fdf0d8;
  --ok: #1f8a5b; --warn: #b5562f; --crit: #b42318; --crit-tint: #fdecea;
  --ff: "Hanken Grotesk", system-ui, sans-serif; --ff-mono: "Spline Sans Mono", ui-monospace, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0f151b; --paper: #17202a; --ink: #e8eef4; --ink-2: #aab8c4; --ink-3: #8494a1;
  --line: #2c3946; --blue: #4ea6dd; --blue-700: #84c6ee; --blue-tint: #152f45;
  --orange: #f3ad2d; --orange-ink: #f6cb7c; --orange-tint: #3a2a0b;
  --ok: #5cc795; --warn: #f0956b; --crit: #ff8a80; --crit-tint: #3b1513; color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #0f151b; --paper: #17202a; --ink: #e8eef4; --ink-2: #aab8c4; --ink-3: #8494a1;
  --line: #2c3946; --blue: #4ea6dd; --blue-700: #84c6ee; --blue-tint: #152f45;
  --orange: #f3ad2d; --orange-ink: #f6cb7c; --orange-tint: #3a2a0b;
  --ok: #5cc795; --warn: #f0956b; --crit: #ff8a80; --crit-tint: #3b1513; color-scheme: dark }
* { box-sizing: border-box }
body { background: var(--bg); color: var(--ink); font: 15px/1.5 var(--ff); -webkit-font-smoothing: antialiased }
.wrap { max-width: 1080px; margin: 0 auto; padding-inline: 16px; padding-block: 28px 48px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 28px }
header { display: grid; gap: 4px }
.eyebrow { font: 600 12px var(--ff-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--blue-700) }
h1 { font-size: clamp(26px, 4vw, 36px); font-weight: 800; letter-spacing: -.02em; margin: 0; text-wrap: balance }
h2 { font-size: 17px; font-weight: 700; margin: 0 0 12px; text-wrap: balance }
.sub { color: var(--ink-2); margin: 0 }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px }
.tile { background: var(--paper); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; display: grid; gap: 2px; min-width: 0 }
.tile .k { font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--ink-2) }
.tile .v { font-size: 28px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -.01em }
.tile .n { font-size: 12.5px; color: var(--ink-3) }
.d { font: 600 12px var(--ff-mono); white-space: nowrap }
.d.up { color: var(--ok) } .d.down { color: var(--warn) } .d.flat { color: var(--ink-3) }
.attn { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none }
.attn li { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; padding: 10px 14px; border-radius: 10px; background: var(--paper); border: 1px solid var(--line) }
.pill { font: 600 11px var(--ff-mono); text-transform: uppercase; letter-spacing: .06em; padding: 2px 8px; border-radius: 99px; flex: none }
.pill.crit { background: var(--crit-tint); color: var(--crit) } .pill.warn { background: var(--orange-tint); color: var(--orange-ink) } .pill.info { background: var(--blue-tint); color: var(--blue-700) }
.attn .where { color: var(--ink-3); font: 12.5px var(--ff-mono) }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 460px), 1fr)); gap: 28px 24px }
section { min-width: 0 }
.card { background: var(--paper); border: 1px solid var(--line); border-radius: 14px; padding: 16px }
.chart { margin: 0 } .chart svg { width: 100%; height: auto; display: block }
.chart .grid { stroke: var(--line); stroke-width: 1 } .chart .ax { fill: var(--ink-3); font: 11px var(--ff-mono) }
.chart .bar path { fill: var(--blue) } .chart .bar .val { fill: var(--ink-2); font: 600 11px var(--ff-mono); opacity: 0 }
.chart .bar:hover path { fill: var(--blue-700) } .chart .bar:hover .val { opacity: 1 }
.chart.sec .bar path { fill: var(--warn) } .chart.sec .bar:hover path { fill: var(--crit) }
.chart.alt .bar path { fill: var(--orange) } .chart.alt .bar:hover path { fill: var(--orange-ink) }
.tw { overflow-x: auto }
table { width: 100%; border-collapse: collapse; font-size: 14px }
th { text-align: left; font-size: 11.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--ink-3); padding: 0 8px 8px; border-bottom: 1px solid var(--line) }
td { padding: 7px 8px; border-bottom: 1px solid var(--line); vertical-align: baseline }
tr:last-child td { border-bottom: 0 }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap }
td.mono { font: 12.5px var(--ff-mono); word-break: break-all }
td.empty { color: var(--ink-3); font-style: italic }
.muted { color: var(--ink-3) }
.meter { display: inline-block; width: 64px; height: 6px; border-radius: 3px; background: var(--line); vertical-align: middle; margin-left: 8px; overflow: hidden }
.meter i { display: block; height: 100%; background: var(--blue); border-radius: 3px }
dl.kv { display: grid; grid-template-columns: 1fr auto; gap: 6px 16px; margin: 0 }
dl.kv dt { color: var(--ink-2) } dl.kv dd { margin: 0; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums }
.notes { color: var(--ink-2); font-size: 13.5px; max-width: 72ch }
.notes ul { padding-left: 18px; margin: 6px 0 0 } .notes li + li { margin-top: 4px }
code { font: 12.5px var(--ff-mono) }
</style>
<div class="wrap">
<header>
  <div class="eyebrow">eisenhower.school · ${DAYS}-day activity</div>
  <h1>${esc(rangeLabel)}</h1>
  <p class="sub">Compared with the ${DAYS} days before (${esc(fmtDay(day(PREV)))} – ${esc(fmtDay(day(addDays(START, -1))))}). Days are UTC. Generated ${esc(new Date().toISOString().slice(0, 16).replace("T", " "))} UTC.</p>
</header>

<div class="tiles">
  ${tile("Visits", fmt(totalVisits), totalVisits, prevVisits)}
  ${tile("Page views", fmt(totalViews), null, null, "Web Analytics")}
  ${tile("Signed-in members", fmt(one("active").n), null, null, isCurrent ? "seen this week" : "seen since start")}
  ${tile("New accounts", fmt(acc.newCur), acc.newCur, acc.newPrev)}
  ${tile("Volunteer sign-ups", fmt(vol.cur), vol.cur, vol.prev)}
  ${tile("Recorded actions", fmt(writesCur), writesCur, writesPrev)}
</div>

<section>
  <h2>Needs attention</h2>
  ${attention.length ? `<ul class="attn">${attention.map(([lvl, msg, where]) => `<li><span class="pill ${lvl}">${{ crit: "Act", warn: "Check", info: "Note" }[lvl]}</span><span>${esc(msg)}</span>${where ? `<span class="where">${esc(where)}</span>` : ""}</li>`).join("")}</ul>` : `<p class="muted">Nothing waiting.</p>`}
</section>

<div class="grid2">
  <section><h2>Visits per day</h2><div class="card">${bars(visitBars, { unit: "visits", title: "Visits per day" })}</div></section>
  <section><h2>Recorded actions per day</h2><div class="card">${bars(writeBars, { unit: "actions", title: "Recorded actions per day" }).replace('class="chart"', 'class="chart alt"')}</div></section>
</div>

<section>
  <h2>By site</h2>
  <div class="card">${table(
    ["Site", '<span class="num">Visits</span>', '<span class="num">Change</span>', '<span class="num">Page views</span>', '<span class="num">Edge requests</span>'],
    siteRows.filter((r) => r.visits || r.prevVisits || r.edge > 50).map((r) => `<tr><td>${esc(r.label)}<div class="muted mono" style="font-size:11.5px">${esc(r.host)}</div></td><td class="num">${fmt(r.visits)}</td><td class="num">${delta(r.visits, r.prevVisits)}</td><td class="num">${fmt(r.views)}</td><td class="num">${fmt(r.edge)}</td></tr>`),
  )}</div>
</section>

<div class="grid2">
  <section><h2>Top pages</h2><div class="card">${table(["Page", '<span class="num">Views</span>'],
    pages.map((p) => `<tr><td class="mono">${esc(p.k)}</td><td class="num">${fmt(p.views)}</td></tr>`))}</div></section>
  <section><h2>Where visitors came from</h2><div class="card">${table(["Referrer", '<span class="num">Visits</span>'],
    refs.map(([k, n]) => `<tr><td class="mono">${esc(k)}</td><td class="num">${fmt(n)}</td></tr>`))}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:20px;margin-top:18px">
      <div>${table(["Device", '<span class="num">Share</span>'], devices.map(([k, n]) => `<tr><td>${esc(k)}</td><td class="num">${Math.round((n / (totalDevices || 1)) * 100)}%${share(n, totalDevices)}</td></tr>`))}</div>
      <div>${table(["Country", '<span class="num">Share</span>'], countries.map(([k, n]) => `<tr><td>${esc(k)}</td><td class="num">${Math.round((n / (totalCountries || 1)) * 100)}%${share(n, totalCountries)}</td></tr>`))}</div>
    </div></div></section>
</div>

<div class="grid2">
  <section><h2>Accounts &amp; access</h2><div class="card"><dl class="kv">
    <dt>Accounts (enabled)</dt><dd>${fmt(acc.enabled)}</dd>
    <dt>Approved to read the directory</dt><dd>${fmt(acc.approved)}</dd>
    <dt>New accounts this week</dt><dd>${fmt(acc.newCur)} ${delta(acc.newCur, acc.newPrev)}</dd>
    <dt>Approved this week</dt><dd>${fmt(acc.approvedCur)}</dd>
    <dt>Waiting for review</dt><dd>${fmt(acc.pending)}</dd>
    <dt>Members who signed in</dt><dd>${fmt(si.cur)} ${delta(si.cur, si.prev)}</dd>
    <dt>People in the directory</dt><dd>${fmt(per.total)}</dd>
    <dt>People added this week</dt><dd>${fmt(per.cur)} ${delta(per.cur, per.prev)}</dd>
    <dt>Accounts that used the read budget</dt><dd>${fmt(rb.users)}</dd>
    <dt>Busiest account's reads in one day</dt><dd>${fmt(rb.maxReads)} <span class="muted">/ 500</span></dd>
  </dl></div></section>

  <section><h2>Newsletter</h2><div class="card">
    ${table(["Issue sent", '<span class="num">Delivered</span>', '<span class="num">Failed</span>'],
      issues.map((i) => `<tr><td>${esc(i.title)}<div class="muted" style="font-size:12.5px">${esc(fmtDay(i.sent_at.slice(0, 10), { weekday: "short", month: "short", day: "numeric" }))} · /n/${esc(i.slug)}</div></td><td class="num">${fmt(i.sent)} <span class="muted">/ ${fmt(i.recipient_total)}</span></td><td class="num">${fmt(i.failed)}</td></tr>`))}
    <dl class="kv" style="margin-top:14px">
      <dt>Confirmed subscribers</dt><dd>${fmt(subs.confirmed)}</dd>
      <dt>New confirmations</dt><dd>${fmt(subs.newCur)} ${delta(subs.newCur, subs.newPrev)}</dd>
      <dt>Unsubscribed (public list)</dt><dd>${fmt(subs.unsubCur)}</dd>
      <dt>Members who opted out</dt><dd>${fmt(one("optOuts").cur)}</dd>
    </dl></div></section>

  <section><h2>Upcoming volunteer sheets</h2><div class="card">${table(["Sheet", "Date", '<span class="num">Filled</span>'],
    (db.sheets ?? []).map((s) => `<tr><td class="mono">${esc(s.slug)}</td><td style="white-space:nowrap">${esc(fmtDay(s.occurrence_start.slice(0, 10), { weekday: "short", month: "short", day: "numeric" }))}</td><td class="num">${fmt(s.filled)} <span class="muted">/ ${fmt(s.slots)}</span>${share(Math.min(s.filled, s.slots), s.slots)}</td></tr>`))}</div></section>

  <section><h2>Lost &amp; found and store</h2><div class="card"><dl class="kv">
    <dt>Items logged</dt><dd>${fmt(lf.foundCur)} ${delta(lf.foundCur, lf.foundPrev)}</dd>
    <dt>Items returned</dt><dd>${fmt(lf.returnedCur)}</dd>
    <dt>Listed publicly now</dt><dd>${fmt(lf.listed)}</dd>
    <dt>Held for review now</dt><dd>${fmt(lf.held)}</dd>
    <dt>Claims received</dt><dd>${fmt(cl.cur)} ${delta(cl.cur, cl.prev)}</dd>
    <dt>Store orders paid</dt><dd>${fmt(st.paidCur)} ${delta(st.paidCur, st.paidPrev)}</dd>
    <dt>Store revenue</dt><dd>${money(st.centsCur)}</dd>
    <dt>Orders shipped</dt><dd>${fmt(st.shippedCur)}</dd>
    <dt>Checkouts not paid</dt><dd>${fmt(st.unpaidCur)}</dd>
  </dl></div></section>
</div>

<section>
  <h2>Recorded actions</h2>
  <div class="card">${table(["Area", "Action", '<span class="num">This week</span>', '<span class="num">Week before</span>'],
    actions.map((a) => `<tr><td>${esc(a.area)}</td><td class="mono">${esc(a.action)}</td><td class="num">${fmt(a.cur)}</td><td class="num">${fmt(a.prev)}</td></tr>`))}</div>
</section>

<div class="grid2">
<section>
  <h2>Edge</h2>
  <div class="card"><dl class="kv">
    <dt>Requests (whole zone)</dt><dd>${fmt(tot(edgeCur, "requests"))} ${delta(tot(edgeCur, "requests"), tot(edgePrev, "requests"))}</dd>
    <dt>Daily unique IPs (average, whole zone)</dt><dd>${fmt(Math.round(tot(edgeCur, "uniques") / (edgeCur.length || 1)))}</dd>
    <dt>Data served</dt><dd>${(tot(edgeCur, "bytes") / 1e9).toFixed(2)} GB</dd>
    <dt>Classified as threats (whole zone)</dt><dd>${fmt(threatsCur)} ${delta(threatsCur, threatsPrev, true)}</dd>
    <dt>Blocked by a rule</dt><dd>${fmt(blockedCur)} ${delta(blockedCur, blockedPrev, true)}</dd>
    <dt>Challenged, logged or skipped</dt><dd>${fmt(nonBlock)}</dd>
    <dt>Scanner noise (odd ports)</dt><dd>${fmt(portNoise)}</dd>
    ${statusClasses.map(([k, n]) => `<dt>Responses ${esc(k)}</dt><dd>${fmt(n)}</dd>`).join("")}
  </dl></div>
</section>
<section><h2>Blocked per day</h2><div class="card">${bars(blockedBars, { unit: "blocked requests", title: "Blocked requests per day" }).replace('class="chart"', 'class="chart sec"')}</div></section>
</div>

<section>
  <h2>What the edge did about threats</h2>
  <div class="card">
    ${table(["Action", "Rule source", '<span class="num">Requests</span>'],
      secActions.map((a) => `<tr><td>${esc(SEC_ACTION[a.action] ?? a.action)}</td><td>${esc(SEC_SOURCE[a.source] ?? a.source)}</td><td class="num">${fmt(a.n)}</td></tr>`))}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:20px;margin-top:18px">
      <div>${table(["Paths probed", '<span class="num">Requests</span>'], secPaths.map(([k, n]) => `<tr><td class="mono">${esc(k)}</td><td class="num">${fmt(n)}</td></tr>`))}</div>
      <div>${table(["Site", '<span class="num">Requests</span>'], secHosts.map(([k, n]) => `<tr><td>${esc(k)}</td><td class="num">${fmt(n)}</td></tr>`))}</div>
      <div>${table(["Country", '<span class="num">Requests</span>'], secCountries.map(([k, n]) => `<tr><td>${esc(k)}</td><td class="num">${fmt(n)}</td></tr>`))}</div>
    </div>
  </div>
</section>

<section class="notes">
  <h2>How to read this</h2>
  <ul>
    <li><b>Visits</b> and <b>page views</b> come from Cloudflare Web Analytics, which counts only pages that load its script. The API and server-to-server traffic never appear there; they are in <b>edge requests</b>.</li>
    <li>A <b>visit</b> starts when someone arrives from outside (a link, a search, a typed address). Moving between our own sites counts as a page view, not a new visit, which is why the directory shows many views and few visits. Web Analytics samples, so figures are rounded.</li>
    <li><b>Recorded actions</b> are rows in the audit log: sign-ins and changes. Reading the directory is never recorded, so a quiet audit log does not mean a quiet site.</li>
    <li><b>Classified as threats</b> is Cloudflare's own count of suspicious requests. <b>Blocked by a rule</b> counts requests a security rule actually stopped, from sampled data, so the two differ slightly. The free plan does not say which individual rule fired; the rule source is as close as it gets.</li>
    <li><b>${EXCLUDED_HOST}</b> is left out. Lines marked <i>whole zone</i> come from daily totals that cannot be split by site, so they still include it.</li>
    <li><b>Signed-in members</b> counts accounts with a session active since the window began.</li>
    <li>Page addresses are shortened: ids and private tokens become <code>:id</code> and <code>:token</code>. This page holds totals only, with no names, emails or IP addresses.</li>
  </ul>
  ${gaps.length ? `<h2 style="margin-top:18px">Gaps</h2><ul>${gaps.map((g) => `<li><code>${esc(g)}</code></li>`).join("")}</ul>` : ""}
</section>
</div>
`;

writeFileSync(OUT, html);
if (args.json) writeFileSync(resolve(args.json), JSON.stringify({ window: { S, E, P }, edge, rum, db, gaps }, null, 2));
console.log(OUT);
console.log(
  `${rangeLabel}: ${fmt(totalVisits)} visits (prev ${fmt(prevVisits)}), ${fmt(acc.newCur)} new accounts, ` +
    `${fmt(vol.cur)} volunteer sign-ups, ${fmt(writesCur)} recorded actions; ${attention.length} attention item(s); ${gaps.length} gap(s).`,
);
