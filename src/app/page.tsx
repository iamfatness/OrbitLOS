import { headers } from "next/headers";
import { Orbit } from "@/components/orbit";
import { loadWorkspace } from "@/lib/workspace-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Home() {
  const requestHeaders = await headers();
  const email = decodeHeader(requestHeaders.get("x-orbit-staff-email"));
  const name = decodeHeader(requestHeaders.get("x-orbit-staff-name"));
  return <Orbit initial={await loadWorkspace()} staff={email ? { email, name: name || email } : null} />;
}

function decodeHeader(value: string | null) {
  if (!value) return "";
  try { return decodeURIComponent(value); }
  catch { return ""; }
}
