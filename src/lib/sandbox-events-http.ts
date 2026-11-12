import { createHash } from "node:crypto";
import { z } from "zod";
import { brokerageIdPattern, demoBrokerageId } from "./brokerage-model";
import type { SandboxEventResult } from "./partner-access";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };

function eventBearer(value: string | null) {
  if (!value || value.length > 150) return null;
  const match = /^Bearer orbit_sandbox\.([a-z0-9-]+)\.([0-9a-f-]+)\.([A-Za-z0-9_-]{43})$/i.exec(value);
  if (!match) return null;
  const [, brokerage, grantId, secret] = match;
  if (!brokerageIdPattern.test(brokerage) || brokerage === demoBrokerageId || !z.uuid().safeParse(grantId).success) return null;
  return { brokerage, grantId, secretHash: createHash("sha256").update(secret).digest("hex") };
}

export async function sandboxEventsHttp(request: Request, url: URL,
  read: (key: NonNullable<ReturnType<typeof eventBearer>>, params: string) => Promise<SandboxEventResult>) {
  if (request.method !== "GET") return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { ...headers, Allow: "GET" } });
  const key = eventBearer(request.headers.get("Authorization"));
  const unauthorized = () => Response.json({ error: "invalid_credential" }, {
    status: 401, headers: { ...headers, "WWW-Authenticate": 'Bearer realm="OrbitLOS sandbox"' },
  });
  if (!key) return unauthorized();
  if (url.search.length > 1024) return Response.json({ error: "invalid_query" }, { status: 400, headers });
  try {
    const result = await read(key, url.search);
    if (result.status === 401) return unauthorized();
    if (result.status === 403) return Response.json({ error: "grant_unavailable" }, {
      status: 403, headers: { ...headers, ...(result.receiptId ? { "Orbit-Receipt-Id": result.receiptId } : {}) },
    });
    if (result.status === 429) return Response.json({ error: "rate_limited" }, { status: 429, headers: { ...headers, "Retry-After": "60" } });
    return Response.json(result.page, {
      status: result.status, headers: { ...headers, "Orbit-Receipt-Id": result.receiptId },
    });
  } catch {
    return Response.json({ error: "sandbox_unavailable" }, { status: 503, headers });
  }
}
