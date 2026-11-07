import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { connect } from "node:net";

const secret = process.env.ORBIT_DOCUMENT_SCANNER_SECRET;
if (!secret || secret.length < 32) throw new Error("Set a strong scanner secret before starting the service.");
const maxBytes = 5 * 1024 * 1024;
const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
const address = process.env.ORBIT_CLAMD_SOCKET
  ? { path: process.env.ORBIT_CLAMD_SOCKET }
  : { host: "127.0.0.1", port: Number(process.env.ORBIT_CLAMD_PORT || 3310) };

function clamScan(bytes) {
  return new Promise((resolve, reject) => {
    const socket = connect(address);
    let response = "";
    const timeout = setTimeout(() => socket.destroy(new Error("Scanner timed out.")), 15_000);
    socket.on("error", reject);
    socket.on("close", () => {
      clearTimeout(timeout);
      reject(new Error("Scanner closed without a verdict."));
    });
    socket.on("connect", () => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(bytes.length);
      socket.write("zINSTREAM\0");
      socket.write(length);
      socket.write(bytes);
      socket.write(Buffer.alloc(4));
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.length > 1024) { socket.destroy(new Error("Unexpected scanner response.")); return; }
      const end = response.indexOf("\0");
      if (end < 0) return;
      const verdict = response.slice(0, end);
      if (verdict === "stream: OK") resolve(true);
      else if (/^stream: .+ FOUND$/.test(verdict)) resolve(false);
      else reject(new Error("Scanner returned an error."));
      socket.destroy();
    });
  });
}

let inFlight = 0;
const service = createServer({ requestTimeout: 20_000, headersTimeout: 5000 }, async (request, response) => {
  const reply = (status, headers = {}) => { response.writeHead(status, { "Cache-Control": "no-store", ...headers }); response.end(); };
  if (request.method !== "POST" || request.url !== "/scan") { reply(404); return; }
  const supplied = createHash("sha256").update(request.headers.authorization ?? "").digest();
  if (!timingSafeEqual(expected, supplied)) { reply(401); return; }
  if (request.headers["content-type"] !== "application/pdf" || request.headers["content-encoding"]) { reply(415); return; }
  if (Number(request.headers["content-length"]) > maxBytes) { reply(413); return; }
  if (inFlight >= 4) { reply(503); return; }
  inFlight++;
  const timeout = setTimeout(() => request.destroy(), 10_000);
  try {
    const chunks = [];
    let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > maxBytes) { reply(413, { Connection: "close" }); return; }
      chunks.push(chunk);
    }
    clearTimeout(timeout);
    if (!length) { reply(400); return; }
    const bytes = Buffer.concat(chunks, length);
    if (!await clamScan(bytes)) { reply(422); return; }
    reply(200, { "X-Orbit-Scan-Sha256": createHash("sha256").update(bytes).digest("hex") });
  } catch { if (!response.destroyed) reply(503); }
  finally { clearTimeout(timeout); inFlight--; }
});

service.listen(Number(process.env.ORBIT_SCANNER_PORT || 8789), "127.0.0.1");
