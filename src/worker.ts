import { DurableObject } from "cloudflare:workers";
import { timingSafeEqual } from "node:crypto";
import app from "vinext/server/app-router-entry";
import { executeCommand } from "./lib/commands";
import { borrowerCommandResult } from "./lib/applications";
import { borrowerHttp, borrowerJson } from "./lib/borrower-http";
import { initializeStore, readWorkspace, type SqlValue, type Store } from "./lib/store";
import { googleSettings, handleStaffAuth, runtimeSetting, signedInStaff } from "./lib/staff-auth";
import { staffAuthStore, type StaffAuthStore, type StaffIdentity, type WorkspaceStaff } from "./lib/staff-store";
import { brokerageIdPattern, brokerageUrl, demoBrokerageId, portalBrokerage } from "./lib/brokerage-model";
import { activateBrokerages, activeBrokerages, bootstrapDemoMembers, brokerageHistory, brokerageMembers, changeBrokerage, initializeBrokerages } from "./lib/brokerages";
import { assignLoan, scopeWorkspace, workspaceAccessHistory } from "./lib/workspace-access";
import { placesHttp, reserveAddressLookup } from "./lib/places";
import { realtorHttp, realtorReferrals } from "./lib/realtor-portal";
import { beginDocumentUpload, documentCleanupBatch, downloadableDocument, failDocumentUpload, finishDocumentUpload,
  issueDocumentCode, nextDocumentCleanup, recordDocumentDownload, verifyDocumentCode, type UploadAccess } from "./lib/document-files";
import { fileProblem, privatePdf, uploadBorrowerPdf, uploadSettings, verifyBorrowerEmail, type DocumentEnvironment } from "./lib/document-file-http";
import { documentKey } from "./lib/document-files-model";
import { z } from "zod";

export class OrbitWorkspace extends DurableObject<Cloudflare.Env> implements StaffAuthStore {
  readonly #store: Store;
  readonly #auth: StaffAuthStore;
  readonly #id: string;
  readonly #documents?: R2Bucket;

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
    if (!ctx.id.name || !brokerageIdPattern.test(ctx.id.name)) throw new Error("Invalid Orbit workspace name.");
    this.#id = ctx.id.name;
    this.#documents = (env as Cloudflare.Env & DocumentEnvironment).DOCUMENTS;
    initializeStore(this.#store, this.#id === demoBrokerageId);
    if (this.#id === demoBrokerageId) initializeBrokerages(this.#store);
    this.#auth = staffAuthStore(this.#store);
  }

  #accepts(staff: WorkspaceStaff | null) {
    return staff ? staff.brokerage.id === this.#id : this.#id === demoBrokerageId;
  }

  read(staff: WorkspaceStaff | null) {
    if (!this.#accepts(staff)) throw new Error("Workspace access denied.");
    return scopeWorkspace(readWorkspace(this.#store), staff);
  }

  async write(input: unknown, staff: WorkspaceStaff | null) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." };
    const result = await executeCommand(this.#store, input, staff);
    if ("state" in result && input && typeof input === "object" && "type" in input && input.type === "deleteLoan") await this.#scheduleCleanup();
    return result;
  }

  issueUploadCode(token: string, secret: string) { return issueDocumentCode(this.#store, token, secret); }
  verifyUploadCode(token: string, code: string, secret: string) { return verifyDocumentCode(this.#store, token, code, secret); }
  async beginUpload(input: UploadAccess) {
    const result = beginDocumentUpload(this.#store, input);
    if ("objectId" in result) await this.#scheduleCleanup();
    return result;
  }
  async finishUpload(input: UploadAccess, objectId: string) {
    const result = finishDocumentUpload(this.#store, input, objectId);
    await this.#scheduleCleanup();
    return result;
  }
  async failUpload(requestId: string, objectId: string) {
    failDocumentUpload(this.#store, requestId, objectId);
    await this.#scheduleCleanup();
  }
  downloadDocument(staff: WorkspaceStaff, requestId: string) {
    return this.#accepts(staff) ? downloadableDocument(this.#store, staff, requestId) : null;
  }
  auditDocumentDownload(staff: WorkspaceStaff, requestId: string, objectId: string) {
    return this.#accepts(staff) && recordDocumentDownload(this.#store, staff, requestId, objectId);
  }
  async #scheduleCleanup() {
    if (!this.#documents) return;
    const next = nextDocumentCleanup(this.#store);
    if (next === null) return;
    try {
      const current = await this.ctx.storage.getAlarm();
      if (current === null || current > next) await this.ctx.storage.setAlarm(next);
    } catch { console.warn("Orbit could not schedule document cleanup."); }
  }
  async alarm() {
    if (!this.#documents) return;
    const objects = documentCleanupBatch(this.#store);
    try {
      if (objects.length) {
        await this.#documents.delete(objects.map((id) => documentKey(this.#id, id)));
        this.#store.transaction(() => {
          for (const id of objects) this.#store.prepare("DELETE FROM document_file_cleanup WHERE objectId = ?").run(id);
        });
      }
    } catch { console.warn("Orbit will retry private document cleanup."); }
    await this.#scheduleCleanup();
  }

  activateStaff(staff: StaffIdentity, emails: string[]) { return activateBrokerages(this.#store, staff, emails); }
  staffBrokerages(email: string, emails: string[]) {
    return this.#store.transaction(() => {
      bootstrapDemoMembers(this.#store, emails);
      return activeBrokerages(this.#store, email, emails);
    });
  }
  hasBrokerage(id: string) { return !!this.#store.prepare("SELECT 1 FROM brokerages WHERE id = ?").get(id); }
  team(staff: WorkspaceStaff, emails: string[]) {
    if (!activeBrokerages(this.#store, staff.email, emails).some((entry) => entry.id === staff.brokerage.id && entry.role === "Admin")) return { members: [], history: [] };
    return { members: brokerageMembers(this.#store, staff.brokerage.id, emails), history: brokerageHistory(this.#store, staff.brokerage.id) };
  }
  manage(staff: WorkspaceStaff, emails: string[], input: unknown) { return changeBrokerage(this.#store, staff.brokerage.id, staff, emails, input); }
  audit(staff: WorkspaceStaff) { return this.#accepts(staff) && staff.brokerage.role === "Admin" ? workspaceAccessHistory(this.#store) : []; }
  reassign(staff: WorkspaceStaff, target: Parameters<typeof assignLoan>[2]) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." };
    return assignLoan(this.#store, staff, target);
  }

  borrower(input: unknown) {
    return borrowerCommandResult(this.#store, input, this.#id === demoBrokerageId || runtimeSetting(this.env, "ORBIT_DOCUMENT_UPLOADS") !== "enabled");
  }

  realtor(input: unknown) {
    return realtorReferrals(this.#store, input);
  }

  reserveAddressLookup(token: string) {
    return reserveAddressLookup(this.#store, token);
  }

  startGoogle(...args: Parameters<StaffAuthStore["startGoogle"]>) { return this.#auth.startGoogle(...args); }
  consumeGoogle(...args: Parameters<StaffAuthStore["consumeGoogle"]>) { return this.#auth.consumeGoogle(...args); }
  createStaffSession(...args: Parameters<StaffAuthStore["createStaffSession"]>) { return this.#auth.createStaffSession(...args); }
  getStaffSession(...args: Parameters<StaffAuthStore["getStaffSession"]>) { return this.#auth.getStaffSession(...args); }
  removeStaffSession(...args: Parameters<StaffAuthStore["removeStaffSession"]>) { return this.#auth.removeStaffSession(...args); }
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
    const reading = request.method === "GET" || request.method === "HEAD";
    const marketingPage = /^\/(?:product\/?|integrations\/?|address-lookup\/?)?$/.test(url.pathname);
    const publicIcon = url.pathname === "/icon.svg";
    // Public documents render independently of the workspace and sign-in.
    // Forward only the URL and method so routing and action headers cannot
    // change the destination of a public request.
    if (reading && (marketingPage || publicIcon || url.pathname === "/api/zip-city-state")) {
      return app.fetch(new Request(url, { method: request.method }), env, context);
    }
    // Build assets are shared by the public site and the workspace.
    if (reading && /^\/_next\/static\/(?:css|chunks)\/[\w.-]+\.(?:js|css)$/.test(url.pathname)) {
      return env.ASSETS.fetch(request);
    }
    const google = googleSettings(env);
    const demoPassword = runtimeSetting(env, "DEMO_PASSWORD");
    if (!google && !demoPassword) {
      return new Response("Orbit demo is being configured.", { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    const directory = env.WORKSPACE.getByName(demoBrokerageId);
    const bootstrapEmails = [...(google?.allowedEmails ?? [])];
    async function linkedWorkspace(input: unknown) {
      const id = portalBrokerage(input && typeof input === "object" && "token" in input ? input.token : input);
      if (!id || (id !== demoBrokerageId && !await directory.hasBrokerage(id))) return null;
      return env.WORKSPACE.getByName(id);
    }
    const filesEnv = env as Cloudflare.Env & DocumentEnvironment;
    const uploads = google ? uploadSettings(filesEnv, url) : null;
    async function uploadWorkspace(token: string) {
      const id = portalBrokerage(token);
      if (!id || id === demoBrokerageId) return null;
      const store = await linkedWorkspace(token);
      return store ? { id, store } : null;
    }
    if (request.method === "POST" && url.pathname === "/api/borrower-documents/verify") {
      return verifyBorrowerEmail(request, uploads, async (token) => (await uploadWorkspace(token))?.store ?? null);
    }
    if (request.method === "POST" && url.pathname === "/api/borrower-documents/upload") {
      try { return await uploadBorrowerPdf(request, uploads, uploadWorkspace); }
      catch { return fileProblem(503, "Orbit could not process this PDF. Try again shortly."); }
    }
    const placesKey = runtimeSetting(env, "GOOGLE_PLACES_API_KEY").trim();
    // This endpoint can reach only the token-scoped borrower command.
    if (request.method === "POST" && url.pathname === "/api/demo-application") {
      return borrowerHttp(request, async (input) => {
        const workspace = await linkedWorkspace(input);
        return workspace ? workspace.borrower(input) : { status: 404, error: "This application link is invalid or expired." };
      }, Boolean(placesKey), Boolean(uploads));
    }
    if (request.method === "POST" && url.pathname === "/api/demo-address") {
      return placesHttp(request, placesKey, async (token) => (await linkedWorkspace(token))?.reserveAddressLookup(token) ?? 404);
    }
    if (request.method === "POST" && url.pathname === "/api/realtor-referrals") {
      return realtorHttp(request, async (input) => {
        const workspace = await linkedWorkspace(input);
        return workspace ? workspace.realtor(input) : { status: 404, error: "This referral link is invalid or expired." };
      });
    }
    const tokenPage = reading && (url.pathname === "/apply" || url.pathname === "/referrals");
    if (google && ["/login", "/auth/google", "/auth/google/callback", "/auth/logout"].includes(url.pathname)) {
      return handleStaffAuth(request, url, google, directory, (staff) => directory.activateStaff(staff, bootstrapEmails));
    }
    let staff: WorkspaceStaff | null = null;
    let brokerages: WorkspaceStaff["brokerage"][] = [];
    if (!tokenPage) {
      if (google) {
        try {
          const identity = await signedInStaff(request, google, directory);
          if (identity) {
            brokerages = await directory.staffBrokerages(identity.email, bootstrapEmails);
            const requested = url.searchParams.get("brokerage");
            const brokerage = requested === null ? brokerages[0] : brokerages.find((entry) => entry.id === requested);
            if (requested !== null && !brokerage && brokerages.length) {
              return new Response("You don’t have access to this brokerage.", { status: 403, headers: { "Cache-Control": "no-store" } });
            }
            if (brokerage) staff = { ...identity, brokerage };
            if (staff && requested === null && staff.brokerage.id !== demoBrokerageId && reading && url.pathname === "/workspace") {
              return new Response(null, { status: 303, headers: { Location: brokerageUrl(staff.brokerage.id), "Cache-Control": "no-store" } });
            }
          }
        }
        catch { return new Response("Orbit sign-in is temporarily unavailable.", { status: 503, headers: { "Cache-Control": "no-store" } }); }
        if (!staff) {
          if (reading) return new Response(null, { status: 303, headers: { Location: "/login", "Cache-Control": "no-store" } });
          return new Response("Sign in to Orbit to continue.", { status: 401, headers: { "Cache-Control": "no-store" } });
        }
      } else if (!(await authorized(request.headers.get("Authorization"), demoPassword))) {
        return new Response("Enter the Orbit demo username and password.", {
          status: 401,
          headers: { "WWW-Authenticate": 'Basic realm="Orbit Demo", charset="UTF-8"', "Cache-Control": "no-store" },
        });
      } else if (url.searchParams.has("brokerage") && url.searchParams.get("brokerage") !== demoBrokerageId) {
        return new Response("Google staff sign-in is required for this brokerage.", { status: 403, headers: { "Cache-Control": "no-store" } });
      }
    }
    if (!reading && request.headers.get("Origin") !== url.origin) {
      return new Response("This action must come from Orbit.", { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "GET" && url.pathname === "/api/documents/download") {
      const requestId = z.uuid().safeParse(url.searchParams.get("request"));
      if (!staff || !filesEnv.DOCUMENTS || !requestId.success) return fileProblem(404, "This PDF is unavailable.");
      const workspace = env.WORKSPACE.getByName(staff.brokerage.id);
      try {
        const document = await workspace.downloadDocument(staff, requestId.data);
        if (!document) return fileProblem(404, "This PDF is unavailable.");
        const object = await filesEnv.DOCUMENTS.get(documentKey(staff.brokerage.id, document.objectId));
        if (!object) return fileProblem(404, "This PDF is unavailable.");
        const access = (await directory.staffBrokerages(staff.email, bootstrapEmails)).find((item) => item.id === staff?.brokerage.id);
        if (!access || !await workspace.auditDocumentDownload({ ...staff, brokerage: access }, requestId.data, document.objectId)) {
          await object.body.cancel();
          return fileProblem(404, "This PDF is unavailable.");
        }
        return privatePdf(object);
      } catch { return fileProblem(503, "Orbit could not retrieve this PDF. Try again shortly."); }
    }
    if (url.pathname === "/api/brokerages") {
      const headers = { "Cache-Control": "private, no-store" };
      if (!staff) return Response.json({ error: "Google staff sign-in is required." }, { status: 403, headers });
      const workspace = env.WORKSPACE.getByName(staff.brokerage.id);
      if (request.method === "GET") {
        const [team, localHistory] = await Promise.all([directory.team(staff, bootstrapEmails), workspace.audit(staff)]);
        const history = [...team.history, ...localHistory].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
        return Response.json({ brokerages, members: team.members, history }, { headers });
      }
      if (request.method === "POST") return borrowerJson<{ message?: string; created?: string }>(request, async (input) => {
        const result = await directory.manage(staff, bootstrapEmails, input);
        if (result.error) return { status: 403, error: result.error };
        if (result.assignment) {
          const assigned = await workspace.reassign(staff, result.assignment);
          return assigned.error ? { status: 409, error: assigned.error } : { value: { message: assigned.message } };
        }
        return { value: { message: result.message, created: result.created } };
      }, 8192);
      return new Response("Method not allowed.", { status: 405, headers });
    }
    const appHeaders = new Headers(request.headers);
    appHeaders.delete("x-orbit-staff-email");
    appHeaders.delete("x-orbit-staff-name");
    appHeaders.delete("x-orbit-brokerage");
    if (staff) {
      appHeaders.set("x-orbit-staff-email", encodeURIComponent(staff.email));
      appHeaders.set("x-orbit-staff-name", encodeURIComponent(staff.name.toWellFormed()));
      appHeaders.set("x-orbit-brokerage", encodeURIComponent(JSON.stringify(staff.brokerage)));
    }
    const response = url.pathname.startsWith("/_next/static/")
      ? await env.ASSETS.fetch(request)
      : await app.fetch(tokenPage ? new Request(url, { method: request.method }) : new Request(request, { headers: appHeaders }), env, context);
    const result = new Response(response.body, response);
    result.headers.set("Cache-Control", "private, no-store");
    result.headers.set("X-Robots-Tag", "noindex");
    if (tokenPage) result.headers.set("Referrer-Policy", "no-referrer");
    return result;
  },
} satisfies ExportedHandler<Cloudflare.Env>;
