import { demoBrokerageId } from "./brokerage-model";
import { readCampaignRouting, distributeCampaignLeads } from "./campaign-routing";
import { linkCampaignLead } from "./call-campaigns";
import { firstContactDue, leadEvent, leadRouting, startLeadFollowUp } from "./lead-inbox";
import { defaultQuoteIntakeConfig, quoteFormChanged, quoteFormUnavailable, quoteIntakeConfig, quoteIntakeSettingsRequest, quoteProfiles, quoteRoutingLabel,
  quotePortalRequest, quoteResponseIssue, quoteSettingsUnavailable, type PublicQuoteForm, type QuoteFormVersion, type QuoteIntakeSettings,
  type QuoteIntakeConfig, type QuoteProfile, type QuotePurpose, type QuoteRoutingPreview, type QuoteRoutingReceipt } from "./quote-intake-model";
import type { StaffIdentity, WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";
import { collectQuoteAnswers } from "./quote-intake-questions";

type QuotePortalResult = { value: PublicQuoteForm | { received: true } } | { status: number; error: string };

function storedQuoteForm(db: Store, profile: QuoteProfile) {
  const row = db.prepare("SELECT revision, config, active FROM quote_intake_versions WHERE profile = ? ORDER BY revision DESC LIMIT 1").get(profile);
  return row ? { profile, revision: Number(row.revision), active: Boolean(row.active),
    config: quoteIntakeConfig.parse(JSON.parse(String(row.config))) } :
    { profile, revision: 0, active: profile === "General", config: defaultQuoteIntakeConfig };
}

function currentQuoteForm(db: Store, purpose?: QuotePurpose): QuoteFormVersion {
  const selected = storedQuoteForm(db, purpose ?? "General");
  return selected.active ? selected : storedQuoteForm(db, "General");
}

function writeQuoteVersion(db: Store, profile: QuoteProfile, config: QuoteFormVersion["config"], active: boolean, staff: WorkspaceStaff, now: string) {
  const next = db.prepare("SELECT coalesce(max(revision), 0) + 1 AS revision FROM quote_intake_versions").get();
  const revision = Number(next?.revision);
  db.prepare("INSERT INTO quote_intake_versions (revision, config, publishedAt, publishedBy, profile, active) VALUES (?, ?, ?, ?, ?, ?)")
    .run(revision, JSON.stringify(config), now, staff.email, profile, Number(active));
  accessEvent(db, staff, active ? "Published quote intake form" : "Retired quote intake profile", `${profile} · v${revision}`, now);
  return { profile, revision, active, config };
}

export function quoteIntakeOwnerRoutes(db: Store, email: string) {
  return quoteProfiles.map((profile) => storedQuoteForm(db, profile)).filter(({ active, config }) => active &&
    (config.ownerEmail === email || config.branches?.some(({ ownerEmail }) => ownerEmail === email)));
}

// Offboarding checks the replacement against the active roster and owns the transaction.
export function transferQuoteIntakeOwner(db: Store, profile: QuoteProfile, revision: number, previousEmail: string,
  ownerEmail: string | null, staff: WorkspaceStaff, now: string) {
  const form = storedQuoteForm(db, profile);
  const { config } = form;
  const direct = config.ownerEmail === previousEmail;
  const branches = config.branches?.map((rule) => rule.ownerEmail === previousEmail ? { ...rule, ownerEmail } : rule);
  if (!form.active || form.revision !== revision || (!direct && !config.branches?.some((rule) => rule.ownerEmail === previousEmail))) {
    return { error: "Intake routing changed. Refresh the offboarding preview." };
  }
  writeQuoteVersion(db, profile, { ...config, ownerEmail: direct ? ownerEmail : config.ownerEmail, branches }, true, staff, now);
  return { message: "Future leads will use the updated intake route." };
}

export function workOnQuoteSettings(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  now = new Date().toISOString(), eligible?: StaffIdentity | StaffIdentity[] | null): QuoteIntakeSettings | QuoteRoutingPreview | { error: string } {
  if (!staff || staff.brokerage.id !== brokerageId || staff.brokerage.role !== "Admin" ||
      (brokerageId !== demoBrokerageId && !staff.brokerage.pilot)) return { error: quoteSettingsUnavailable };
  const parsed = quoteIntakeSettingsRequest.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the quote form settings." };
  const data = parsed.data;
  const roster = Array.isArray(eligible) ? eligible : eligible ? [eligible] : [];
  return db.transaction(() => {
    const { profile } = data;
    let form = storedQuoteForm(db, profile);
    if (data.type !== "read") {
      if (form.revision !== data.revision) return { error: "The form changed. Reload the published settings before saving." };
      if (data.type === "publish" || data.type === "previewRoute") {
        if (data.config.campaignId && !db.prepare("SELECT 1 FROM call_campaigns WHERE id = ?").get(data.config.campaignId)) {
          return { error: "Choose an available call campaign." };
        }
        if (data.type === "publish" && quoteConfiguredOwners(data.config).some((email) => !roster.some((member) => member.email === email))) {
          return { error: "Choose an active loan officer or admin in this brokerage." };
        }
        if (data.type === "previewRoute") {
          if (data.config.zip === "Required" && !data.zip) return { error: "Enter a property ZIP to preview this profile." };
          if (data.config.contact === "Phone required" && !data.hasPhone) return { error: "This profile requires a phone number." };
          const route = resolveQuoteRouting(db, { profile, revision: form.revision, config: data.config }, data.zip);
          const campaign = route.campaignName && data.hasPhone;
          return { routingPreview: campaign ? campaignReceipt(route, "Campaign queue", route.campaign?.enabled
            ? "An eligible request can be assigned to an available campaign officer. The shared campaign queue holds overflow."
            : "Automatic campaign assignment is off. Eligible requests enter the shared campaign queue.") : directReceipt(route, roster,
            route.campaignName ? "No phone number was supplied for the call campaign." : "").receipt };
        }
      }
      const active = data.type === "publish";
      const config = active ? data.config : form.config;
      if (active !== form.active || JSON.stringify(form.config) !== JSON.stringify(config)) {
        form = writeQuoteVersion(db, profile, config, active, staff, now);
      }
    }
    const effective = form.active ? form : storedQuoteForm(db, "General");
    const search = data.type === "read" ? data.search : "";
    const campaigns = db.prepare(`SELECT id, name FROM call_campaigns WHERE instr(lower(name), lower(?)) > 0
      ORDER BY name COLLATE NOCASE, id LIMIT 20`).all(search) as QuoteIntakeSettings["campaigns"];
    if (effective.config.campaignId && !campaigns.some(({ id }) => id === effective.config.campaignId)) {
      const selected = db.prepare("SELECT id, name FROM call_campaigns WHERE id = ?").get(effective.config.campaignId) as QuoteIntakeSettings["campaigns"][number] | undefined;
      if (selected) campaigns.unshift(selected);
    }
    const history = db.prepare("SELECT revision, publishedAt, active FROM quote_intake_versions WHERE profile = ? ORDER BY revision DESC LIMIT 8").all(profile)
      .map(({ revision, publishedAt, active }) => ({ revision: Number(revision), publishedAt: String(publishedAt), active: Boolean(active) }));
    return { ...form, config: effective.config, effectiveRevision: effective.revision, campaigns, history };
  });
}

export function quoteConfiguredOwners(config: QuoteIntakeConfig) {
  return [...new Set([config.ownerEmail, ...(config.branches ?? []).map(({ ownerEmail }) => ownerEmail)])]
    .filter((email): email is string => typeof email === "string");
}

function resolveQuoteRouting(db: Store, form: QuoteFormVersion, zip: string) {
  const routing = leadRouting(db);
  const { campaignId, branches } = form.config;
  const campaign = campaignId ? readCampaignRouting(db, campaignId) : undefined;
  const name = campaignId ? db.prepare("SELECT name FROM call_campaigns WHERE id = ?").get(campaignId)?.name : undefined;
  const campaignName = typeof name === "string" ? name : null;
  const branch = form.config.zip !== "Hidden" && zip
    ? branches?.find((rule) => rule.zip === zip) ?? branches?.find((rule) => rule.zip === zip.slice(0, 3)) : undefined;
  const ownerEmail = form.config.ownerEmail === undefined ? routing.websiteOwner : form.config.ownerEmail;
  return { routing, form, campaign, campaignName, branch, ownerEmail };
}

export function quoteIntakeRouting(db: Store, purpose?: QuotePurpose, zip = "") {
  return resolveQuoteRouting(db, currentQuoteForm(db, purpose), zip);
}

type QuoteRouting = ReturnType<typeof quoteIntakeRouting>;
function receiptBasis(route: QuoteRouting) {
  return { profile: route.form.profile, formRevision: route.form.revision, websiteRevision: route.routing.revision,
    branch: route.branch ? { name: route.branch.name, zip: route.branch.zip } : null };
}

function directReceipt(route: QuoteRouting, members: StaffIdentity[], skipReason: string) {
  const branchOwner = members.find(({ email }) => email === route.branch?.ownerEmail);
  const useBranch = !!route.branch && (!!branchOwner || route.branch.ownerEmail === null);
  const owner = useBranch ? branchOwner : members.find(({ email }) => email === route.ownerEmail);
  const rule = useBranch ? "Branch default" : route.form.config.ownerEmail !== undefined ? "Profile default" :
    route.ownerEmail ? "Website default" : "Shared inbox";
  const note = [skipReason, route.branch && !useBranch && "The branch LO was unavailable. Used the profile’s fallback.",
    !useBranch && route.ownerEmail && !owner && "The fallback LO was unavailable. Used the shared inbox."].filter(Boolean).join(" ");
  const receipt: QuoteRoutingReceipt = { ...receiptBasis(route), rule, note, campaign: null,
    destination: owner?.name.slice(0, 160) ?? "Shared inbox" };
  return { receipt, owner };
}

function campaignReceipt(route: QuoteRouting, destination: string, note: string): QuoteRoutingReceipt {
  return { ...receiptBasis(route), rule: "Call campaign", branch: null, destination, note,
    campaign: { name: route.campaignName ?? "Call campaign", revision: route.campaign?.revision ?? null } };
}

export function receiveQuoteLead(db: Store, input: unknown, snapshot?: ReturnType<typeof quoteIntakeRouting>, members: StaffIdentity[] = [],
  now = new Date().toISOString()): QuotePortalResult {
  const parsed = quotePortalRequest.safeParse(input);
  if (!parsed.success) return { status: 400, error: "Enter a name, an email or phone, a valid ZIP if provided, and permission to follow up." };
  const data = parsed.data;
  return db.transaction(() => {
    const current = leadRouting(db);
    if (!current.quoteToken || data.token !== current.quoteToken) return { status: 404, error: quoteFormUnavailable };
    if (data.type === "read") {
      const form = currentQuoteForm(db, data.purpose);
      const { title, introduction, theme, contact, zip, timing, question, questions } = form.config;
      return { value: { profile: form.profile, revision: form.revision, config: { title, introduction, theme, contact, zip, timing, question,
        questions: questions.map((item) => ({ ...item, prefill: null })) } } };
    }
    if (db.prepare("SELECT 1 FROM referral_leads WHERE realtorId IS NULL AND requestId = ?").get(data.requestId)) return { value: { received: true } };
    const effective = quoteIntakeRouting(db, data.purpose, data.zip);
    const { form } = effective;
    const captured = snapshot ?? effective;
    if (form.revision !== data.formRevision) return { status: 409, error: quoteFormChanged };
    if (current.revision !== captured.routing.revision || form.revision !== captured.form.revision) {
      return { status: 409, error: "Routing changed. Submit your request again." };
    }
    const issue = quoteResponseIssue(form.config, data);
    if (issue) return { status: 400, error: issue };
    const structured = collectQuoteAnswers(form.config.questions, data.answers);
    if ("error" in structured) return { status: 400, error: structured.error };
    const lastHour = new Date(Date.parse(now) - 3_600_000).toISOString();
    const count = db.prepare("SELECT count(*) AS total FROM referral_leads WHERE realtorId IS NULL AND createdAt > ?").get(lastHour);
    if (Number(count?.total) >= 30) return { status: 429, error: "This form has reached its hourly limit. Try again later." };
    const id = crypto.randomUUID();
    const { campaignId } = form.config;
    const wantsCampaign = !!campaignId && !!data.phone;
    const direct = directReceipt(effective, members, campaignId && !data.phone ? "No phone number was supplied for the call campaign." : "");
    const owner = wantsCampaign ? undefined : direct.owner;
    const zip = form.config.zip === "Hidden" ? "" : data.zip;
    const timing = form.config.timing === "Hidden" ? "" : data.timing;
    const answer = form.config.question ? data.answer : "";
    db.prepare(`INSERT INTO referral_leads (id, requestId, realtorId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt, zip, importSource)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Website quote request')`)
      .run(id, data.requestId, data.name, data.email, data.phone, data.purpose, owner?.name.slice(0, 160) ?? "", owner?.email ?? null, now,
        firstContactDue(now, current), zip);
    startLeadFollowUp(db, id, now, data);
    let enrolled: string | null = null;
    let routeReceipt = direct.receipt;
    if (campaignId && wantsCampaign) {
      const linked = linkCampaignLead(db, campaignId, id, now);
      if ("added" in linked) {
        enrolled = campaignId;
        if (effective.campaign?.enabled && effective.campaign.revision === captured.campaign?.revision) {
          distributeCampaignLeads(db, null, campaignId, members, now, [id]);
        }
        const assigned = db.prepare("SELECT officer FROM referral_leads WHERE id = ?").get(id)?.officer;
        const held = effective.campaign?.revision !== captured.campaign?.revision;
        routeReceipt = campaignReceipt(effective, String(assigned || "Shared campaign queue"), held
          ? "Campaign rules changed during intake. Assignment stayed in the shared queue."
          : assigned ? "Assigned by campaign routing at submission." : "The campaign kept this lead in its shared queue.");
      } else {
        const { owner, receipt } = directReceipt(effective, members, "This request could not join the call campaign.");
        routeReceipt = receipt;
        if (owner) db.prepare("UPDATE referral_leads SET officer = ?, officerEmail = ? WHERE id = ?").run(owner.name.slice(0, 160), owner.email, id);
      }
    }
    db.prepare(`INSERT INTO quote_intake_receipts (leadId, formRevision, timing, answer, campaignId, profile, structuredAnswers, routingReceipt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, form.revision, timing, answer, enrolled, form.profile, JSON.stringify(structured.answers), JSON.stringify(routeReceipt));
    const intake = [`Website quote request · Form version ${form.revision}`,
      form.profile !== "General" && `${form.profile} profile`,
      timing && `Timeline · ${timing}`, answer && form.config.question && `${form.config.question.prompt} · ${answer}`].filter(Boolean);
    leadEvent(db, id, "Quote form", now, [...intake, ...structured.answers.map(({ prompt, value }) => `${prompt} · ${value}`)].join(" · "));
    leadEvent(db, id, "Website routing", now, [quoteRoutingLabel(routeReceipt), routeReceipt.note].filter(Boolean).join(" · "));
    return { value: { received: true } };
  });
}
