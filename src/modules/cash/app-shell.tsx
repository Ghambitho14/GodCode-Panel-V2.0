import { useEffect, useRef, useState } from "react";
import { useAntiZoom } from "./use-anti-zoom";

interface AppShellProps {
  children: React.ReactNode;
}

/** Shell visual legado (clases `tenant-*` conservadas para paridad 1:1). */
export function AppShell({ children }: AppShellProps) {
  const [scrollY, setScrollY] = useState(0);
  const bgLayerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useAntiZoom();

  useEffect(() => {
    if (!bgLayerRef.current) return;
    bgLayerRef.current.style.transform = `translateY(${-scrollY * 0.1}px)`;
  }, [scrollY]);

  return (
    <div className="tenant-shell-root">
      <div ref={bgLayerRef} className="app-bg-layer tenant-shell-bg-layer" />
      <div id="app-content-layer" className="app-wrapper tenant-content-layer">
        {children}
      </div>
      <div id="app-ui-layer" className="tenant-ui-layer">
        <div id="modal-root" className="tenant-portal-modal" />
      </div>
    </div>
  );
}
