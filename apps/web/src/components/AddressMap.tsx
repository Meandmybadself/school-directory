// A server-rendered static map for an address. The image is produced by the
// Worker from coordinates it never sends to the browser; we only reference the
// /contacts/:id/map endpoint here. Hides itself if the map can't be produced.
import { useState } from "react";
import { mediaUrl } from "../lib/api.js";

export function AddressMap({ contactId }: { contactId: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <img
        src={mediaUrl(`/contacts/${contactId}/map`) ?? undefined}
        alt="Map of this address"
        loading="lazy"
        onError={() => setFailed(true)}
        style={{ width: "50%", height: 100, objectFit: "cover", borderRadius: 10, border: "1px solid var(--line)", display: "block" }}
      />
      <div className="sd-meta" style={{ fontSize: 10.5, marginTop: 3 }}>© OpenStreetMap contributors</div>
    </div>
  );
}
