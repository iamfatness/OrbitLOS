export const directoryPauseKey = "operations/directory-recovery/pause";
export const directoryPauseRetrySeconds = 60;

export async function directoryTrafficPaused(bucket: Pick<R2Bucket, "head"> | undefined): Promise<boolean> {
  if (!bucket) return true;
  try {
    return await bucket.head(directoryPauseKey) !== null;
  } catch {
    // Directory traffic must stay closed when the independent control is unavailable.
    return true;
  }
}

export function directoryPauseResponse(request: Request): Response {
  const headers = {
    "Cache-Control": "private, no-store",
    "Retry-After": String(directoryPauseRetrySeconds),
    "X-Orbit-Maintenance": "directory-recovery",
    "X-Robots-Tag": "noindex",
  };
  const message = "Orbit workspace access is temporarily paused for maintenance. Please try again shortly.";
  if (new URL(request.url).pathname.startsWith("/api/") && request.method !== "HEAD") {
    return Response.json({ error: message }, { status: 503, headers });
  }
  return new Response(request.method === "HEAD" ? null : message, {
    status: 503,
    headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
  });
}
