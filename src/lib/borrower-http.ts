import type { BorrowerResult } from "./application-model";

const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };
const maxRequestBytes = 16_384;

function problem(error: string, status: number) {
  return Response.json({ error }, { status, headers });
}

export async function borrowerHttp(request: Request, run: (input: unknown) => Promise<BorrowerResult>) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) return problem("Open the application directly in Orbit.", 403);
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json") return problem("Send the application as JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) return problem("The application request is empty.", 400);

  const decoder = new TextDecoder();
  let content = "";
  let bytes = 0;
  let input: unknown;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxRequestBytes) {
        await reader.cancel();
        return problem("The application request is too large.", 413);
      }
      content += decoder.decode(value, { stream: true });
    }
    input = JSON.parse(content + decoder.decode());
  } catch {
    return problem("The application request could not be read.", 400);
  } finally {
    reader.releaseLock();
  }
  try {
    const result = await run(input);
    if ("error" in result) return problem(result.error, result.status);
    return Response.json(result.application, { headers });
  } catch {
    return problem("Orbit could not load or save the application. Try again.", 500);
  }
}
