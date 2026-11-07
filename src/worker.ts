import { DurableObject } from "cloudflare:workers";
import { timingSafeEqual } from "node:crypto";
import app from "vinext/server/app-router-entry";
import { executeCommand } from "./lib/commands";
import { borrowerCommandResult } from "./lib/applications";
import { borrowerHttp, borrowerJson, documentUploadMode } from "./lib/borrower-http";
import { initializeStore, readWorkspace, type SqlValue, type Store } from "./lib/store";
import { googleSettings, handleStaffAuth, runtimeSetting, signedInStaff, staffLoginUrl } from "./lib/staff-auth";
import { staffAuthStore, type StaffAuthStore, type StaffIdentity, type WorkspaceStaff } from "./lib/staff-store";
import { brokerageIdPattern, brokerageUrl, demoBrokerageId, portalBrokerage } from "./lib/brokerage-model";
import { activateBrokerages, activeBrokerages, bootstrapDemoMembers, brokerageHistory, brokerageMembers, changeBrokerage, initializeBrokerages } from "./lib/brokerages";
import { assignLoan, scopeWorkspace, workspaceAccessHistory } from "./lib/workspace-access";
import { placesHttp, reserveAddressLookup } from "./lib/places";
import { realtorHttp, realtorReferrals } from "./lib/realtor-portal";
import { beginDocumentUpload, documentCleanupBatch, downloadableDocument, failDocumentUpload, finishDocumentUpload,
  issueDocumentCode, nextDocumentCleanup, recordDocumentDownload, verifyDocumentCode, type UploadAccess } from "./lib/document-files";
import { fileProblem, privatePdf, uploadBorrowerPdf, uploadSettings, verifyBorrowerEmail, type DocumentEnvironment } from "./lib/document-file-http";
import { documentKey, type DocumentUploadMode } from "./lib/document-files-model";
import { z } from "zod";
import { loadPilotScenario, pilotFeedbackInput, pilotReview, pilotScenarioInput, pilotTriageInput, recordPilotMeasurement, savePilotFeedback, triagePilotFeedback } from "./lib/pilot";
import { migrationInput } from "./lib/pipeline-migration-model";
import { assignInboxLeadInput, quoteLeadInput, saveLeadRoutingInput } from "./lib/lead-inbox-model";
import { leadRouting, receiveQuoteLead } from "./lib/lead-inbox";
import { assignProcessor } from "./lib/loan-processing";

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
    return scopeWorkspace(readWorkspace(this.#store, staff?.brokerage.role === "Admin"), staff);
  }

  async write(input: unknown, staff: WorkspaceStaff | null) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." };
    let referralOwner: StaffIdentity | undefined;
    let leadMembers: StaffIdentity[] = [];
    if (staff?.brokerage.role === "Admin" && input && typeof input === "object" && "type" in input &&
      input.type === "createRealtorPortal" && "officerEmail" in input && typeof input.officerEmail === "string" &&
      input.officerEmail !== staff.email) {
      const emails = [...(googleSettings(this.env)?.allowedEmails ?? [])];
      const team = this.#id === demoBrokerageId ? this.team(staff, emails)
        : await this.env.WORKSPACE.getByName(demoBrokerageId).team(staff, emails);
      referralOwner = team.members.find((member) => member.email === input.officerEmail && member.status === "Active" && member.role !== "Processor");
      if (!referralOwner) return { error: "Select an active staff member in this brokerage." };
    }
    if (staff?.brokerage.role === "Admin" && (saveLeadRoutingInput.safeParse(input).success || assignInboxLeadInput.safeParse(input).success || (staff.brokerage.pilot && migrationInput.safeParse(input).success))) {
      const emails = [...(googleSettings(this.env)?.allowedEmails ?? [])];
      const team = this.#id === demoBrokerageId ? this.team(staff, emails)
        : await this.env.WORKSPACE.getByName(demoBrokerageId).team(staff, emails);
      leadMembers = team.members.filter((member) => member.status === "Active" && member.role !== "Processor");
    }
    const result = await executeCommand(this.#store, input, staff, referralOwner, leadMembers);
    if ("state" in result && input && typeof input === "object" && "type" in input && input.type === "deleteLoan") await this.#scheduleCleanup();
    return result;
  }

  async #permitsUpload(mode: DocumentUploadMode) {
    const flag = runtimeSetting(this.env, "ORBIT_DOCUMENT_UPLOADS").trim();
    const details = this.#id === demoBrokerageId ? { pilot: false }
      : await this.env.WORKSPACE.getByName(demoBrokerageId).brokerageDetails(this.#id);
    return !!details && documentUploadMode(flag === "mock" ? "mock" : flag === "enabled" ? "live" : undefined, this.#id, details.pilot) === mode;
  }
  async issueUploadCode(token: string, secret: string, mode: DocumentUploadMode) {
    if (!await this.#permitsUpload(mode)) return { status: 503, error: "PDF uploads are unavailable." };
    return issueDocumentCode(this.#store, token, secret, mode);
  }
  async verifyUploadCode(token: string, code: string, secret: string, mode: DocumentUploadMode) {
    if (!await this.#permitsUpload(mode)) return { status: 503, error: "PDF uploads are unavailable." };
    return verifyDocumentCode(this.#store, token, code, secret, mode);
  }
  async beginUpload(input: UploadAccess) {
    if (!await this.#permitsUpload(input.mode)) return { status: 503, error: "PDF uploads are unavailable." };
    const result = beginDocumentUpload(this.#store, input);
    if ("objectId" in result) await this.#scheduleCleanup();
    return result;
  }
  async finishUpload(input: UploadAccess, objectId: string) {
    if (!await this.#permitsUpload(input.mode)) return { status: 503, error: "PDF uploads are unavailable." };
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
  staffInvitedTo(id: string, email: string) {
    return this.#id === demoBrokerageId && !!this.#store.prepare("SELECT 1 FROM brokerage_members WHERE brokerageId = ? AND email = ? AND status = 'Invited'").get(id, email);
  }
  brokerageDetails(id: string) {
    if (this.#id !== demoBrokerageId) return null;
    const row = this.#store.prepare("SELECT pilot FROM brokerages WHERE id = ?").get(id);
    return row ? { pilot: Boolean(row.pilot) } : null;
  }
  hasBrokerage(id: string) { return !!this.brokerageDetails(id); }
  leadOwner(id: string, email: string, emails: string[]): StaffIdentity | null {
    if (this.#id !== demoBrokerageId) return null;
    const member = brokerageMembers(this.#store, id, emails).find((item) => item.email === email && item.status === "Active" && item.role !== "Processor");
    return member ? { email: member.email, name: member.name } : null;
  }
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
  shareProcessing(staff: WorkspaceStaff, target: Parameters<typeof assignProcessor>[2]) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." } as const;
    return assignProcessor(this.#store, staff, target);
  }

  pilotReview(staff: WorkspaceStaff) {
    return this.#accepts(staff) && staff.brokerage.pilot && staff.brokerage.role === "Admin" ? pilotReview(this.#store) : {};
  }
  async loadPilot(staff: WorkspaceStaff, input: unknown, owner: StaffIdentity) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." } as const;
    const result = loadPilotScenario(this.#store, staff, input, owner);
    if ("message" in result) await this.#scheduleCleanup();
    return result;
  }
  pilotFeedback(staff: WorkspaceStaff, input: unknown) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." } as const;
    return savePilotFeedback(this.#store, staff, input);
  }
  pilotTriage(staff: WorkspaceStaff, input: unknown) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." } as const;
    return triagePilotFeedback(this.#store, staff, input);
  }
  pilotMeasurement(staff: WorkspaceStaff, input: unknown) {
    if (!this.#accepts(staff)) return { error: "Workspace access denied." } as const;
    return recordPilotMeasurement(this.#store, staff, input);
  }
  borrower(input: unknown, pilot = false) {
    return borrowerCommandResult(this.#store, input,
      pilot || this.#id === demoBrokerageId || runtimeSetting(this.env, "ORBIT_DOCUMENT_UPLOADS") !== "enabled", pilot);
  }
  async #resolveLeadOwner(email: string | null, emails: string[]) {
    if (!email) return null;
    return this.#id === demoBrokerageId ? this.leadOwner(this.#id, email, emails)
      : await this.env.WORKSPACE.getByName(demoBrokerageId).leadOwner(this.#id, email, emails);
  }
  async realtor(input: unknown, pilot = false, emails: string[] = []) {
    if (!input || typeof input !== "object" || !("type" in input) || input.type !== "submit") {
      return realtorReferrals(this.#store, input, undefined, pilot);
    }
    const routing = leadRouting(this.#store);
    let target = routing.realtorOwner;
    if (routing.realtorRoute === "Link owner") {
      if (!googleSettings(this.env) || !("token" in input) || typeof input.token !== "string") return realtorReferrals(this.#store, input, undefined, pilot);
      const portal = this.#store.prepare("SELECT officerEmail FROM realtor_portals WHERE token = ?").get(input.token);
      target = typeof portal?.officerEmail === "string" ? portal.officerEmail : null;
    }
    const owner = await this.#resolveLeadOwner(target, emails);
    return realtorReferrals(this.#store, input, undefined, pilot, { revision: routing.revision, owner });
  }
  async quoteLead(input: unknown, emails: string[]) {
    const routing = leadRouting(this.#store);
    const parsed = quoteLeadInput.safeParse(input);
    const owner = parsed.success && routing.quoteToken === parsed.data.token ? await this.#resolveLeadOwner(routing.websiteOwner, emails) : null;
    return receiveQuoteLead(this.#store, input, routing, owner);
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
      if (!id) return null;
      const details = id === demoBrokerageId ? { pilot: false } : await directory.brokerageDetails(id);
      return details ? { id, pilot: details.pilot, store: env.WORKSPACE.getByName(id) } : null;
    }
    const filesEnv = env as Cloudflare.Env & DocumentEnvironment;
    const uploads = google ? uploadSettings(filesEnv, url) : null;
    async function uploadWorkspace(token: string) {
      const link = await linkedWorkspace(token);
      return link && documentUploadMode(uploads?.mode, link.id, link.pilot) ? link : null;
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
        const link = await linkedWorkspace(input);
        if (!link) return { status: 404, error: "This application link is invalid or expired." };
        const result = await link.store.borrower(input, link.pilot);
        return { ...result, uploadsMode: documentUploadMode(uploads?.mode, link.id, link.pilot) };
      }, Boolean(placesKey));
    }
    if (request.method === "POST" && url.pathname === "/api/demo-address") {
      return placesHttp(request, placesKey, async (token) => (await linkedWorkspace(token))?.store.reserveAddressLookup(token) ?? 404);
    }
    if (request.method === "POST" && url.pathname === "/api/realtor-referrals") {
      return realtorHttp(request, async (input) => {
        const link = await linkedWorkspace(input);
        return link ? link.store.realtor(input, link.pilot, bootstrapEmails) : { status: 404, error: "This referral link is invalid or expired." };
      });
    }
    if (request.method === "POST" && url.pathname === "/api/quote-requests") {
      return borrowerJson(request, async (input) => {
        const link = await linkedWorkspace(input);
        return link && (link.pilot || link.id === demoBrokerageId) ? link.store.quoteLead(input, bootstrapEmails)
          : { status: 404, error: "This quote request link is unavailable." };
      }, 2048);
    }
    const tokenPage = reading && (url.pathname === "/apply" || url.pathname === "/referrals" || url.pathname === "/quote");
    if (google && ["/login", "/auth/google", "/auth/google/callback", "/auth/logout"].includes(url.pathname)) {
      return handleStaffAuth(request, url, google, directory, (staff) => directory.activateStaff(staff, bootstrapEmails));
    }
    let staff: WorkspaceStaff | null = null;
    let brokerages: WorkspaceStaff["brokerage"][] = [];
    if (!tokenPage) {
      if (google) {
        const requested = url.searchParams.get("brokerage");
        const workspaceTarget = reading && url.pathname === "/workspace" && requested && brokerageIdPattern.test(requested) ? requested : null;
        const login = () => new Response(null, { status: 303, headers: { Location: staffLoginUrl(workspaceTarget), "Cache-Control": "no-store" } });
        try {
          const identity = await signedInStaff(request, google, directory);
          if (identity) {
            brokerages = await directory.staffBrokerages(identity.email, bootstrapEmails);
            const brokerage = requested === null ? brokerages[0] : brokerages.find((entry) => entry.id === requested);
            if (requested !== null && !brokerage && brokerages.length) {
              if (workspaceTarget && await directory.staffInvitedTo(workspaceTarget, identity.email)) return login();
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
          if (reading) return login();
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
        return privatePdf(object, staff.brokerage.id === demoBrokerageId || Boolean(staff.brokerage.pilot));
      } catch { return fileProblem(503, "Orbit could not retrieve this PDF. Try again shortly."); }
    }
    if (url.pathname === "/api/brokerages") {
      const headers = { "Cache-Control": "private, no-store" };
      if (!staff) return Response.json({ error: "Google staff sign-in is required." }, { status: 403, headers });
      const workspace = env.WORKSPACE.getByName(staff.brokerage.id);
      if (request.method === "GET") {
        const [team, localHistory, pilot] = await Promise.all([directory.team(staff, bootstrapEmails), workspace.audit(staff), workspace.pilotReview(staff)]);
        const history = [...team.history, ...localHistory].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
        return Response.json({ brokerages, members: team.members, history, ...pilot }, { headers });
      }
      if (request.method === "POST") return borrowerJson<{ message?: string; created?: string }>(request, async (input) => {
        if (input && typeof input === "object" && "type" in input && input.type === "pilotFeedback") {
          if (!staff.brokerage.pilot || !pilotFeedbackInput.safeParse(input).success) return { status: 400, error: "Choose a pilot step and enter feedback up to 1,000 characters." };
          const result = await workspace.pilotFeedback(staff, input);
          return "error" in result ? { status: 409, error: result.error } : { value: result };
        }
        if (input && typeof input === "object" && "type" in input && input.type === "triagePilotFeedback") {
          if (!staff.brokerage.pilot || staff.brokerage.role !== "Admin") return { status: 403, error: "Only a pilot admin can update feedback." };
          const parsed = pilotTriageInput.safeParse(input);
          if (!parsed.success) return { status: 400, error: "Check the feedback status and retest result." };
          if (parsed.data.owner) {
            const team = await directory.team(staff, bootstrapEmails);
            if (!team.members.some((member) => member.status === "Active" && member.email === parsed.data.owner)) {
              return { status: 409, error: "Select an active staff member in this pilot workspace." };
            }
          }
          const result = await workspace.pilotTriage(staff, parsed.data);
          return "error" in result ? { status: 409, error: result.error } : { value: result };
        }
        if (input && typeof input === "object" && "type" in input && input.type === "recordPilotMeasurement") {
          if (!staff.brokerage.pilot || staff.brokerage.role !== "Admin") return { status: 403, error: "Only a pilot admin can record measurements." };
          const result = await workspace.pilotMeasurement(staff, input);
          return "error" in result ? { status: 409, error: result.error } : { value: result };
        }
        if (input && typeof input === "object" && "type" in input && input.type === "loadPilotScenario") {
          if (!staff.brokerage.pilot || staff.brokerage.role !== "Admin") return { status: 403, error: "Only a pilot admin can load or reset the scenario." };
          const parsed = pilotScenarioInput.safeParse(input);
          if (!parsed.success) return { status: 400, error: "Refresh Team and select an active staff member." };
          const team = await directory.team(staff, bootstrapEmails);
          const owner = team.members.find((member) => member.status === "Active" && member.role !== "Processor" && member.email === parsed.data.officerEmail);
          if (!owner) return { status: 409, error: "Select an active staff member in this pilot workspace." };
          const result = await workspace.loadPilot(staff, parsed.data, owner);
          return "error" in result ? { status: 409, error: result.error } : { value: result };
        }
        const result = await directory.manage(staff, bootstrapEmails, input);
        if (result.error) return { status: 403, error: result.error };
        if (result.assignment) {
          const assigned = await workspace.reassign(staff, result.assignment);
          return assigned.error ? { status: 409, error: assigned.error } : { value: { message: assigned.message } };
        }
        if (result.processorAssignment) {
          const assigned = await workspace.shareProcessing(staff, result.processorAssignment);
          return "error" in assigned ? { status: 409, error: assigned.error } : { value: assigned };
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
