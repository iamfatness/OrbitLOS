import { createHash, timingSafeEqual } from "node:crypto";
import { directoryPauseKey } from "./directory-traffic-pause";

export const directoryDrainObject = "orbit-directory-drain";
export const directoryDrainPath = "/api/ops/directory-drain";
export type DirectoryWorkKind = "http" | "alarm";
export type DirectoryWorkCounts = { active: number; http: number; alarms: number; oldestAt: number | null };

export interface DirectoryDrainTracker {
  beginDirectoryWork(id: string, kind: DirectoryWorkKind): Promise<boolean>;
  endDirectoryWork(id: string): Promise<void>;
  directoryWorkCounts(): Promise<DirectoryWorkCounts>;
}

export async function startDirectoryWork(namespace: { getByName(name: string): DirectoryDrainTracker }, kind: DirectoryWorkKind) {
  const id = crypto.randomUUID();
  try {
    const tracker = namespace.getByName(directoryDrainObject);
    if (!await tracker.beginDirectoryWork(id, kind)) return null;
    return async () => {
      try {
        // A coordinator restart can invalidate the admission stub. Completion
        // is idempotent and can be recorded through a fresh connection.
        await namespace.getByName(directoryDrainObject).endDirectoryWork(id);
      } catch {
        console.warn("Orbit could not record recovery work completion.");
      }
    };
  } catch (error) {
    console.warn("Orbit could not admit directory work.", error instanceof Error ? error.message.slice(0, 180) : "unknown error");
    // The handler has not started. A lost admission acknowledgment may leave
    // a ticket that operators must investigate before recovering the directory.
    return null;
  }
}

export async function readDirectoryIncident(request: Request, bucket: R2Bucket | undefined,
  capability: "status" | "evidence" | "repair" = "status") {
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("Authorization") ?? "")?.[1];
  if (!token || !bucket) return null;
  const marker = await bucket.get(directoryPauseKey);
  if (!marker || marker.size > 1024) {
    await marker?.body.cancel();
    return null;
  }
  const { incident, statusTokenSha256, evidenceTokenSha256, repairTokenSha256 } = await marker.json<{
    incident?: unknown; statusTokenSha256?: unknown; evidenceTokenSha256?: unknown; repairTokenSha256?: unknown;
  }>();
  const tokenSha256 = capability === "repair" ? repairTokenSha256 : capability === "evidence" ? evidenceTokenSha256 : statusTokenSha256;
  if (typeof incident !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(incident) ||
      typeof tokenSha256 !== "string" || !/^[a-f0-9]{64}$/.test(tokenSha256)) return null;
  const actual = createHash("sha256").update(token).digest();
  return timingSafeEqual(actual, Buffer.from(tokenSha256, "hex")) ? { incident, version:marker.version } : null;
}

export async function directoryDrainStatus(request: Request, bucket: R2Bucket | undefined,
  readCounts: () => Promise<DirectoryWorkCounts>) {
  const hidden = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  if (request.method !== "GET" || !bucket) return hidden();
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };
  try {
    const marker = await readDirectoryIncident(request,bucket);
    if (!marker) return hidden();
    const counts = await readCounts();
    const current = await bucket.head(directoryPauseKey);
    if (!current || current.version !== marker.version) {
      return Response.json({ error: "The incident marker changed. Refresh before reviewing drain status." }, { status: 409, headers });
    }
    return Response.json({ incident: marker.incident, checkedAt: new Date().toISOString(), ...counts,
      state: counts.active === 0 ? "Tracked work drained" : "Tracked work outstanding" }, { headers });
  } catch {
    return Response.json({ error: "Directory drain status is unavailable." }, { status: 503, headers });
  }
}

export async function trackDirectoryResponse(context: ExecutionContext, end: () => Promise<void>,
  run: (trackedContext: ExecutionContext) => Promise<Response>) {
  const pending = new Set<Promise<unknown>>();
  const trackedContext = new Proxy(context, {
    get(target, property) {
      if (property === "waitUntil") return (work: Promise<unknown>) => {
        const settled = Promise.resolve(work).then(() => undefined, () => undefined);
        pending.add(settled);
        void settled.then(() => pending.delete(settled));
        target.waitUntil(work);
      };
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  async function finish() {
    while (pending.size) await Promise.all(pending);
    await end();
  }
  let response: Response;
  try {
    response = await run(trackedContext);
  } catch (error) {
    context.waitUntil(finish());
    throw error;
  }
  if (!response.body) {
    context.waitUntil(finish());
    return response;
  }
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  context.waitUntil(response.body.pipeTo(stream.writable).then(finish, finish));
  return new Response(stream.readable, response);
}
