import { DurableObject } from "cloudflare:workers";
import { timingSafeEqual } from "node:crypto";
import app from "vinext/server/app-router-entry";
import { executeCommand } from "./lib/commands";
import { borrowerCommandResult } from "./lib/applications";
import { borrowerHttp } from "./lib/borrower-http";
import { initializeStore, workspace, type SqlValue, type Store } from "./lib/store";

export class OrbitWorkspace extends DurableObject<Cloudflare.Env> {
  readonly #store: Store;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    const storage = ctx.storage;
    const sql = storage.sql;
    this.#store = {
      exec: (query) => { sql.exec(query).toArray(); },
      prepare(query) {
        return {
          get: (...args) => sql.exec<Record<string, SqlValue>>(query, ...args).toArray()[0],
          all: (...args) => sql.exec<Record<string, SqlValue>>(query, ...args).toArray(),
          run: (...args) => { sql.exec(query, ...args).toArray(); },
        };
      },
      transaction: (run) => storage.transactionSync(run),
    };
    initializeStore(this.#store);
  }

  read() {
    return workspace(this.#store);
  }

  async write(input: unknown) {
    return executeCommand(this.#store, input);
  }

  borrower(input: unknown) {
    return borrowerCommandResult(this.#store, input);
  }
}

async function authorized(header: string | null, password: string) {
  if (!header || !header.startsWith("Basic ") || header.length > 200) return false;
  const encoder = new TextEncoder();
  const expected = `Basic ${btoa(`orbit:${password}`)}`;
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(header)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return timingSafeEqual(new Uint8Array(actualHash), new Uint8Array(expectedHash));
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (url.hostname === "orbitlos.com" && url.protocol !== "https:") {
      url.protocol = "https:";
      return Response.redirect(url, 308);
    }
    if (!env.DEMO_PASSWORD) {
      return new Response("Orbit demo is being configured.", { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    const reading = request.method === "GET" || request.method === "HEAD";
    // Shared build assets carry no workspace data. The public write endpoint can
    // reach only the token-scoped borrower command, never the staff server action.
    if (reading && /^\/_next\/static\/(?:css|chunks)\/[\w.-]+\.(?:js|css)$/.test(url.pathname)) {
      return env.ASSETS.fetch(request);
    }
    if (request.method === "POST" && url.pathname === "/api/demo-application") {
      return borrowerHttp(request, (input) => env.WORKSPACE.getByName("orbit-demo").borrower(input));
    }
    const borrowerPage = reading && url.pathname === "/apply";
    const publicIcon = reading && url.pathname === "/icon.svg";
    if (!borrowerPage && !publicIcon && !(await authorized(request.headers.get("Authorization"), env.DEMO_PASSWORD))) {
      return new Response("Enter the Orbit demo username and password.", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="Orbit Demo", charset="UTF-8"', "Cache-Control": "no-store" },
      });
    }
    if (!reading && request.headers.get("Origin") !== url.origin) {
      return new Response("This action must come from Orbit.", { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    const response = url.pathname.startsWith("/_next/static/")
      ? await env.ASSETS.fetch(request)
      : await app.fetch(request, env, context);
    const result = new Response(response.body, response);
    result.headers.set("Cache-Control", "private, no-store");
    result.headers.set("X-Robots-Tag", "noindex");
    if (borrowerPage) result.headers.set("Referrer-Policy", "no-referrer");
    return result;
  },
} satisfies ExportedHandler<Cloudflare.Env>;
