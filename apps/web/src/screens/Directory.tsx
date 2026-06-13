// Members directory — searchable list of everyone in the community. Names are
// visible to members (last name per the owner's rule); contact details live on
// the privacy-filtered profile each row links to.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Capability, PersonSummaryDTO } from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Tag } from "../components/atoms.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, MemberRow } from "../components/parts.js";
import { useI18n } from "../i18n/index.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api } from "../lib/api.js";

function capTags(caps: Capability[]) {
  return caps.map((c) => (
    <Tag key={c} tone={c === "teacher" ? "orange" : c === "student" ? "line" : "blue"}>
      {c.charAt(0).toUpperCase() + c.slice(1).replace("_", " ")}
    </Tag>
  ));
}

export function Directory() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<PersonSummaryDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  // Debounced search; resets the list on each query change.
  useEffect(() => {
    const id = ++reqId.current;
    const handle = setTimeout(() => {
      setLoading(true);
      void api
        .directory(q, 0)
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
  }, [q]);

  const loadMore = async () => {
    const r = await api.directory(q, people.length);
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

  const list = (
    <div className="sd-card sd-card-pad" style={{ paddingTop: 4, paddingBottom: 4 }}>
      {people.map((p) => (
        <MemberRow
          key={p.id}
          name={p.displayName}
          tags={capTags(p.capabilities)}
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
          {meta}
          {list}
        </div>
      </div>
    </AppShell>
  );
}
