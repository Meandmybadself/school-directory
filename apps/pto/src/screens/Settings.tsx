// Which group's roster may use the boards. System admins only.
//
// This is the single lever over who gets in, which is why the route behind it is
// audited (`pto.group.configured`) and why the screen says out loud what picking
// a group does. The group itself is an ordinary `generic` group, created and
// rostered in the directory app with the tools that already exist — there is no
// second membership model here, deliberately.
//
// With nothing chosen, only system admins are admitted. That is the bootstrap
// state rather than a broken one, and the copy below says so: an admin who has
// just deployed this needs to know the empty screen is expected.
import { useEffect, useState } from "react";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { Btn } from "../components/atoms.js";
import { ScreenHeader } from "../components/parts.js";
import { SiteFooter } from "../components/SiteFooter.js";
import { api, errorMessage, DIRECTORY_URL } from "../lib/api.js";
import { useAccess } from "../lib/access.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";

interface GroupRow {
  id: string;
  name: string;
  memberCount: number;
}

function Body() {
  const { access, refresh } = useAccess();
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .groups()
      .then((r) => setGroups(r.groups))
      .catch(() => setGroups([]));
  }, []);

  const choose = async (groupId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await api.setGroup(groupId);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Couldn't save that."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: "16px 16px 40px", display: "flex", flexDirection: "column", gap: 14, maxWidth: 620 }}>
      <div>
        <h2 className="sd-h2" style={{ margin: 0 }}>
          Who can use the boards
        </h2>
        <p className="sd-lead" style={{ marginTop: 8 }}>
          Pick the group whose roster is the PTO board. Anyone who controls a Person on it gets in;
          system admins always do. Until you pick one, only system admins can open the boards.
        </p>
        <p className="sd-meta" style={{ marginTop: 8 }}>
          Groups and their rosters are managed in the directory —{" "}
          <a className="sd-link" href={`${DIRECTORY_URL}/groups`}>
            directory.eisenhower.school
          </a>
          . Only <b>generic</b> groups are offered here: a household or a classroom is a different
          kind of thing and shouldn't double as a committee.
        </p>
      </div>

      {error && <div className="sd-meta" style={{ color: "var(--warn)" }}>{error}</div>}

      {groups === null ? (
        <div className="sd-meta">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="sd-card sd-card-pad">
          <div style={{ fontWeight: 700 }}>No groups yet</div>
          <p className="sd-meta" style={{ marginTop: 6 }}>
            Create one in the directory (Admin → Groups), add the board members to it, then come
            back here.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {groups.map((g) => {
            const on = access?.groupId === g.id;
            return (
              <button
                key={g.id}
                type="button"
                className="sd-row"
                disabled={busy}
                onClick={() => void choose(on ? null : g.id)}
                style={{
                  gap: 12,
                  padding: "13px 14px",
                  borderRadius: 12,
                  width: "100%",
                  textAlign: "left",
                  font: "inherit",
                  cursor: "pointer",
                  border: `1px solid ${on ? "var(--blue)" : "var(--line)"}`,
                  background: on ? "var(--blue-tint)" : "var(--paper)",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{g.name}</div>
                  <div className="sd-meta">
                    {g.memberCount} {g.memberCount === 1 ? "member" : "members"}
                  </div>
                </div>
                {on && <span className="sd-meta" style={{ fontWeight: 700 }}>Selected</span>}
              </button>
            );
          })}
        </div>
      )}

      {access?.groupId && (
        <Btn kind="ghost" disabled={busy} onClick={() => void choose(null)}>
          Clear — system admins only
        </Btn>
      )}
    </div>
  );
}

export function Settings() {
  const isDesktop = useIsDesktop();
  if (isDesktop) {
    return (
      <DesktopShell active="settings" title="Settings">
        <Body />
      </DesktopShell>
    );
  }
  return (
    <AppShell bottomNav={<BottomNav active="settings" />}>
      <ScreenHeader title="Settings" left="arrowleft" onLeft={() => (window.location.href = "/boards")} />
      <div className="sd-scroll">
        <Body />
        <SiteFooter />
      </div>
    </AppShell>
  );
}
