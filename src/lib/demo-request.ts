import { z } from "zod";

const inputSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().max(254),
  brokerage: z.string().trim().min(2).max(160),
  teamSize: z.enum(["Just me", "2–5", "6–20", "21–50", "51+"]),
  interests: z.string().trim().max(1200).default(""),
  website: z.string().max(200).default(""),
});

const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const problem = (error: string, status: number) => Response.json({ error }, { status, headers });

export async function demoRequest(request: Request, env: Pick<Cloudflare.Env, "DEMO_EMAIL" | "DEMO_RATE_LIMIT"> & { ORBIT_DEMO_INBOX?: string }) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });
  if (request.headers.get("Origin") !== new URL(request.url).origin) return problem("Open the form on OrbitLOS to send your request.", 403);
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") return problem("Send your request using the demo form.", 415);
  if (!env.DEMO_EMAIL || !env.DEMO_RATE_LIMIT || !env.ORBIT_DEMO_INBOX) {
    return problem("The form is temporarily unavailable. Email demo@orbitlos.com instead.", 503);
  }
  const reader = request.body?.getReader();
  if (!reader) return problem("Complete the demo request form.", 400);
  let content = "";
  let bytes = 0;
  const decoder = new TextDecoder();
  let input: unknown;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) { await reader.cancel(); return problem("Please shorten your request.", 413); }
      content += decoder.decode(value, { stream: true });
    }
    input = JSON.parse(content + decoder.decode());
  } catch { return problem("We couldn’t read the request. Please try again.", 400); }
  finally { reader.releaseLock(); }
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return problem("Enter your name, a valid email, brokerage, and team size.", 400);
  if (parsed.data.website) return problem("We couldn’t accept this request. Email demo@orbitlos.com instead.", 400);
  try {
    const limit = await env.DEMO_RATE_LIMIT.limit({ key: `demo:${request.headers.get("CF-Connecting-IP") ?? "local"}` });
    if (!limit.success) return Response.json({ error: "Please wait a minute before trying again, or email demo@orbitlos.com." }, { status: 429, headers: { ...headers, "Retry-After": "60" } });
    const { name, email, brokerage, teamSize, interests } = parsed.data;
    const reference = crypto.randomUUID();
    await env.DEMO_EMAIL.send({
      from: { email: "demo@orbitlos.com", name: "OrbitLOS website" },
      to: env.ORBIT_DEMO_INBOX,
      replyTo: email,
      subject: "OrbitLOS demo request",
      text: `New website demo request\n\nName: ${name}\nWork email: ${email}\nBrokerage: ${brokerage}\nTeam size: ${teamSize}\n\nWhat they’d like to explore:\n${interests || "Not specified"}\n\nRequest reference: ${reference}`,
    });
    return Response.json({ sent: true, reference }, { headers });
  } catch {
    // Do not log prospect details or provider errors that could contain them.
    console.error("OrbitLOS demo request delivery failed");
    return problem("We couldn’t send your request. Your entries are still here—try again or email demo@orbitlos.com.", 503);
  }
}
