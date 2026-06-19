// A server-rendered static map for an address. The image is produced by the
// Worker from coordinates it never sends to the browser; we only reference the
// /contacts/:id/map endpoint here. Hides itself if the map can't be produced.
// When the address string is known (controllers see it), the map links out to
// Google Maps in a new tab.
import { useState } from "react";
import { mediaUrl } from "../lib/api.js";

function googleMapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function AddressMap({ contactId, address, width = "50%" }: { contactId: string; address?: string; width?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  const img = (
    <img
      src={mediaUrl(`/contacts/${contactId}/map`) ?? undefined}
      alt="Map of this address"
      loading="lazy"
      onError={() => setFailed(true)}
      style={{ width: "100%", height: 100, objectFit: "cover", borderRadius: 10, border: "1px solid var(--line)", display: "block" }}
    />
  );
  // The click target matches the image, which is sized to `width` of its container.
  return (
    <div style={{ marginTop: 8 }}>
      {address ? (
        <a
          href={googleMapsUrl(address)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open this address in Google Maps"
          title="Open in Google Maps"
          style={{ display: "block", width }}
        >
          {img}
        </a>
      ) : (
        <div style={{ width }}>{img}</div>
      )}
      <div className="sd-meta" style={{ fontSize: 10.5, marginTop: 3 }}>© OpenStreetMap contributors © CARTO</div>
    </div>
  );
}
