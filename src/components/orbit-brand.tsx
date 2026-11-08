import { Orbit } from "lucide-react";

export function OrbitRings() {
  return <svg className="orbit-rings" viewBox="0 0 520 250" aria-hidden="true" fill="none">
    <g stroke="currentColor">
      <ellipse cx="365" cy="108" rx="174" ry="57" transform="rotate(-23 365 108)" />
      <ellipse cx="365" cy="108" rx="203" ry="78" transform="rotate(-23 365 108)" />
      <ellipse cx="365" cy="108" rx="232" ry="99" transform="rotate(-23 365 108)" />
    </g>
    <circle cx="250" cy="172" r="5" fill="currentColor" />
    <circle cx="450" cy="36" r="4" fill="currentColor" />
  </svg>;
}

export function PortalHeader({ label }: { label: string }) {
  return <header className="portal-masthead">
    <div className="application-top">
      <div className="brand"><span className="brand-icon"><Orbit size={22} aria-hidden="true" /></span>OrbitLOS</div>
      <span className="pill">{label}</span>
    </div>
  </header>;
}
