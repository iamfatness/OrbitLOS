import { Orbit } from "@/components/orbit";
import { loadWorkspace } from "@/lib/workspace-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Home() {
  return <Orbit initial={await loadWorkspace()} />;
}
