// Connectivity detection. navigator.onLine is unreliable, so we also listen for
// online/offline events. (A heartbeat to /health can be layered in for M3.)
import { useEffect, useState } from "react";

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}
