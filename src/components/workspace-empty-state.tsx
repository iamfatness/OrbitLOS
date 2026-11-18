import { Orbit } from "lucide-react";
import type { ReactNode } from "react";

export function WorkspaceEmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="workspace-empty">
    <Orbit aria-hidden="true" size={25} />
    <strong>{title}</strong>
    {children && <p>{children}</p>}
  </div>;
}
