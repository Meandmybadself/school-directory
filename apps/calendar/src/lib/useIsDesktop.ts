// Desktop breakpoint. The design board switches from the mobile phone column to
// the sidebar layout at wide widths; 900px is the crossover.
import { useEffect, useState } from "react";

const QUERY = "(min-width: 900px)";

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia(QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const on = () => setIsDesktop(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return isDesktop;
}
