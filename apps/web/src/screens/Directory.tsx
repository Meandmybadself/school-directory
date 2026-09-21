// Members directory — searchable list of everyone in the community. Names are
// visible to members (last name per the owner's rule); contact details live on
// the privacy-filtered profile each row links to.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ROLE_CAPABILITIES, roleCapabilities, shortClassroomName } from "@sd/shared";
import type { Capability, ClassroomRefDTO, PersonSummaryDTO } from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Tag } from "../components/atoms.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, MemberRow } from "../components/parts.js";
import { capLabel, useI18n, type I18nT } from "../i18n/index.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api, mediaUrl } from "../lib/api.js";

/** Role tags only — see `ROLE_CAPABILITIES` for why `household_admin` is not
 *  one of them. The filter chips below draw from the same list, so a row can
 *  never be selected by a tag it doesn't show (invariant 18). */
function capTags(caps: Capability[], t: I18nT) {
  return roleCapabilities(caps).map((c) => (
    <Tag key={c} tone={c === "teacher" ? "orange" : c === "student" ? "line" : "blue"}>
      {capLabel(t, c)}
    </Tag>
  ));
}

/** The rooms a Person is on the roster of, as the row's subline.
 *
 *  A subline rather than another Tag: a classroom's name is whatever the school
 *  called it ("Room 3 — Mr. Alvarez"), where a tag is `white-space: nowrap` and
 *  sits beside a name that has to stay readable. The name itself is
 *  member-entered content and so is never translated (invariant 6), and a child
 *  in two rooms reads as one line — `ClassroomCandidateDTO.currentClassrooms`
 *  being a list is the same fact the placement sheet already shows.
 *
 *  The `school` icon carries the "this is a classroom" reading and nothing else
 *  does, which is the shape `GroupCard` on the profile already uses for the very
 *  same group: `Icon` is `aria-hidden` by construction, so a screen reader gets
 *  the room's name on its own. That is the existing bargain here, not a new one
 *  — a label would want a visually-hidden utility, and tokens.css is copied into
 *  five apps, so adding one is a decision about all five rather than about this
 *  row.
 *
 *  The name is ELIDED by `shortClassroomName`, which keeps the grade and the
 *  room and drops the middle. Leaving it to CSS was the first answer and it was
 *  the wrong one: ellipsis clips from the end, and in this instance the end is
 *  the room number, so every child in a grade truncated to the same
 *  `Grade 2 · Juntos · Pam Sh…` on the very list that exists to tell them
 *  apart. The `title` carries the school's full name for a hover and for
 *  anything that reads the DOM, so the middle is dropped from the LABEL, never
 *  from the row.
 *
 *  `minWidth: 0` sits on the flex container as well as on the text inside it,
 *  which is #24's lesson rather than belt-and-braces: an ellipsis fires only
 *  when every box between the text and the constrained ancestor can shrink, and
 *  that bug was one box too low every time. Today the row's own column carries
 *  the constraint; this is what keeps the subline honest if it is ever dropped
 *  into a grid, where a track would otherwise size to the un-elided name.
 *
 *  `classrooms` is optional on the DTO, so `undefined` (a listing that didn't
 *  look) and `[]` (on nobody's roster) both render nothing — deliberately the
 *  same outcome, since a row announcing "no classroom" would be noise on the
 *  parents, who are most of this list. */
function classroomLine(rooms: ClassroomRefDTO[] | undefined) {
  if (!rooms?.length) return undefined;
  return (
    <span className="sd-row" style={{ gap: 5, minWidth: 0 }} title={rooms.map((r) => r.name).join(", ")}>
      <Icon name="school" size={13} style={{ flex: "0 0 auto" }} />
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {rooms.map((r) => shortClassroomName(r.name)).join(", ")}
      </span>
    </span>
  );
}

export function Directory() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [q, setQ] = useState("");
  // Selected roles read as OR, matching the server: no chip on is "everyone".
  const [caps, setCaps] = useState<Capability[]>([]);
  const [people, setPeople] = useState<PersonSummaryDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  // Debounced search; resets the list on each query or filter change. The
  // filter shares the debounce so a burst of chip taps issues one request, and
  // shares `reqId` so a slower earlier response can't overwrite a newer one.
  const capKey = caps.join(",");
  useEffect(() => {
    const id = ++reqId.current;
    const handle = setTimeout(() => {
      setLoading(true);
      void api
        .directory(q, 0, caps)
        .then((r) => {
          if (id !== reqId.current) return; // stale response
          setPeople(r.people);
          setTotal(r.total);
        })
        .catch(() => {
          if (id === reqId.current) { setPeople([]); setTotal(0); }
        })
        .finally(() => id === reqId.current && setLoading(false));
    }, 200);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, capKey]);

  const loadMore = async () => {
    const r = await api.directory(q, people.length, caps);
    setPeople((prev) => [...prev, ...r.people]);
    setTotal(r.total);
  };

  const searchBar = (
    <div style={{ position: "relative" }}>
      <Icon name="search" size={17} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)" }} />
      <input
        className="sd-input"
        placeholder={t("searchMembers")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus={isDesktop}
        style={{ paddingLeft: 38 }}
      />
    </div>
  );

  const toggleCap = (c: Capability) =>
    setCaps((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const filters = (
    <div className="sd-chips" role="group" aria-label={t("filterByRole")}>
      <button
        type="button"
        className={`sd-chip ${caps.length === 0 ? "on" : ""}`}
        aria-pressed={caps.length === 0}
        onClick={() => setCaps([])}
      >
        {t("filterAllRoles")}
      </button>
      {ROLE_CAPABILITIES.map((c) => (
        <button
          key={c}
          type="button"
          className={`sd-chip ${caps.includes(c) ? "on" : ""}`}
          aria-pressed={caps.includes(c)}
          onClick={() => toggleCap(c)}
        >
          {capLabel(t, c)}
        </button>
      ))}
    </div>
  );

  const list = (
    <div className="sd-card sd-card-pad" style={{ paddingTop: 4, paddingBottom: 4 }}>
      {people.map((p) => (
        <MemberRow
          key={p.id}
          name={p.displayName}
          img={mediaUrl(p.photoUrl)}
          tags={capTags(p.capabilities, t)}
          title={classroomLine(p.classrooms)}
          onClick={() => navigate(`/persons/${p.id}`)}
          trailing={<Icon name="chevright" size={17} style={{ color: "var(--ink-3)" }} />}
        />
      ))}
      {people.length === 0 && !loading && (
        <div className="sd-meta" style={{ padding: "14px 0" }}>{t("directoryEmpty")}</div>
      )}
      {people.length < total && (
        <button className="sd-btn sd-btn-ghost sd-btn-sm block" style={{ marginTop: 8 }} onClick={() => void loadMore()}>
          {t("loadMore")}
        </button>
      )}
    </div>
  );

  const meta = total > 0 ? <p className="sd-meta" style={{ margin: "0 2px" }}>{t("showingOf", { shown: people.length, total })}</p> : null;

  if (isDesktop) {
    return (
      <DesktopShell active="dir" title={t("navDir")}>
        <div style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: 14 }}>
          {searchBar}
          {filters}
          {meta}
          {list}
        </div>
      </DesktopShell>
    );
  }
  return (
    <AppShell bottomNav={<BottomNav active="dir" />}>
      <ScreenHeader title={t("navDir")} onLeft={() => navigate("/")} />
      <div className="sd-scroll">
        <div className="sd-body" style={{ gap: 12 }}>
          {searchBar}
          {filters}
          {meta}
          {list}
        </div>
      </div>
    </AppShell>
  );
}
