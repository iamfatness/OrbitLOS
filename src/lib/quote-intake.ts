import { demoBrokerageId } from "./brokerage-model";
import { readCampaignRouting, distributeCampaignLeads } from "./campaign-routing";
import { linkCampaignLead } from "./call-campaigns";
import { firstContactDue, leadEvent, leadRouting, startLeadFollowUp } from "./lead-inbox";
import { defaultQuoteIntakeConfig, quoteFormChanged, quoteFormUnavailable, quoteIntakeConfig, quoteIntakeSettingsRequest,
  quotePortalRequest, quoteResponseIssue, quoteSettingsUnavailable, type PublicQuoteForm, type QuoteFormVersion, type QuoteIntakeSettings } from "./quote-intake-model";
import type { StaffIdentity, WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

type QuotePortalResult = { value: PublicQuoteForm | { received: true } } | { status: number; error: string };

function currentQuoteForm(db: Store): QuoteFormVersion {
  const row = db.prepare("SELECT revision, config FROM quote_intake_versions ORDER BY revision DESC LIMIT 1").get();
  return row ? { revision: Number(row.revision), config: quoteIntakeConfig.parse(JSON.parse(String(row.config))) } :
    { revision: 0, config: defaultQuoteIntakeConfig };
}

export function workOnQuoteSettings(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  now = new Date().toISOString()): QuoteIntakeSettings | { error: string } {
  if (!staff || staff.brokerage.id !== brokerageId || staff.brokerage.role !== "Admin" ||
      (brokerageId !== demoBrokerageId && !staff.brokerage.pilot)) return { error: quoteSettingsUnavailable };
  const parsed = quoteIntakeSettingsRequest.safeParse(input);
  if (!parsed.success) return { error: "Check the form text, required fields, and campaign selection." };
  const data = parsed.data;
  return db.transaction(() => {
    let form = currentQuoteForm(db);
    if (data.type === "publish") {
      if (form.revision !== data.revision) return { error: "The form changed. Reload the published settings before saving." };
      if (data.config.campaignId && !db.prepare("SELECT 1 FROM call_campaigns WHERE id = ?").get(data.config.campaignId)) {
        return { error: "Choose an available call campaign." };
      }
      if (JSON.stringify(form.config) !== JSON.stringify(data.config)) {
        form = { revision: form.revision + 1, config: data.config };
        db.prepare("INSERT INTO quote_intake_versions (revision, config, publishedAt, publishedBy) VALUES (?, ?, ?, ?)")
          .run(form.revision, JSON.stringify(form.config), now, staff.email);
        accessEvent(db, staff, "Published quote intake form", String(form.revision), now);
      }
    }
    const search = data.type === "read" ? data.search : "";
    const campaigns = db.prepare(`SELECT id, name FROM call_campaigns WHERE instr(lower(name), lower(?)) > 0
      ORDER BY name COLLATE NOCASE, id LIMIT 20`).all(search) as QuoteIntakeSettings["campaigns"];
    if (form.config.campaignId && !campaigns.some(({ id }) => id === form.config.campaignId)) {
      const selected = db.prepare("SELECT id, name FROM call_campaigns WHERE id = ?").get(form.config.campaignId) as QuoteIntakeSettings["campaigns"][number] | undefined;
      if (selected) campaigns.unshift(selected);
    }
    return { ...form, campaigns };
  });
}

export function quoteIntakeRouting(db: Store) {
  const routing = leadRouting(db);
  const form = currentQuoteForm(db);
  const campaign = form.config.campaignId ? readCampaignRouting(db, form.config.campaignId) : undefined;
  return { routing, form, campaign };
}

export function receiveQuoteLead(db: Store, input: unknown, snapshot = quoteIntakeRouting(db), members: StaffIdentity[] = [],
  now = new Date().toISOString()): QuotePortalResult {
  const parsed = quotePortalRequest.safeParse(input);
  if (!parsed.success) return { status: 400, error: "Enter a name, an email or phone, a valid ZIP if provided, and permission to follow up." };
  const data = parsed.data;
  return db.transaction(() => {
    const current = leadRouting(db);
    if (!current.quoteToken || data.token !== current.quoteToken) return { status: 404, error: quoteFormUnavailable };
    const form = currentQuoteForm(db);
    if (data.type === "read") {
      const { title, introduction, theme, contact, zip, timing, question } = form.config;
      return { value: { revision: form.revision, config: { title, introduction, theme, contact, zip, timing, question } } };
    }
    if (db.prepare("SELECT 1 FROM referral_leads WHERE realtorId IS NULL AND requestId = ?").get(data.requestId)) return { value: { received: true } };
    if (form.revision !== data.formRevision) return { status: 409, error: quoteFormChanged };
    if (current.revision !== snapshot.routing.revision || form.revision !== snapshot.form.revision) {
      return { status: 409, error: "Routing changed. Submit your request again." };
    }
    const issue = quoteResponseIssue(form.config, data);
    if (issue) return { status: 400, error: issue };
    const lastHour = new Date(Date.parse(now) - 3_600_000).toISOString();
    const count = db.prepare("SELECT count(*) AS total FROM referral_leads WHERE realtorId IS NULL AND createdAt > ?").get(lastHour);
    if (Number(count?.total) >= 30) return { status: 429, error: "This form has reached its hourly limit. Try again later." };
    const id = crypto.randomUUID();
    const fallback = members.find(({ email }) => email === current.websiteOwner);
    const { campaignId } = form.config;
    const wantsCampaign = !!campaignId && !!data.phone;
    const owner = wantsCampaign ? undefined : fallback;
    const zip = form.config.zip === "Hidden" ? "" : data.zip;
    const timing = form.config.timing === "Hidden" ? "" : data.timing;
    const answer = form.config.question ? data.answer : "";
    db.prepare(`INSERT INTO referral_leads (id, requestId, realtorId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt, zip, importSource)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Website quote request')`)
      .run(id, data.requestId, data.name, data.email, data.phone, data.purpose, owner?.name.slice(0, 160) ?? "", owner?.email ?? null, now,
        firstContactDue(now, current), zip);
    startLeadFollowUp(db, id, now, data);
    let enrolled: string | null = null;
    if (campaignId && wantsCampaign) {
      const linked = linkCampaignLead(db, campaignId, id, now);
      if ("added" in linked) {
        enrolled = campaignId;
        const active = readCampaignRouting(db, campaignId);
        if (active?.enabled && active.revision === snapshot.campaign?.revision) distributeCampaignLeads(db, null, campaignId, members, now, [id]);
      } else if (fallback) {
        db.prepare("UPDATE referral_leads SET officer = ?, officerEmail = ? WHERE id = ?").run(fallback.name.slice(0, 160), fallback.email, id);
      }
    }
    db.prepare("INSERT INTO quote_intake_receipts (leadId, formRevision, timing, answer, campaignId) VALUES (?, ?, ?, ?, ?)")
      .run(id, form.revision, timing, answer, enrolled);
    const intake = [`Website quote request · Form version ${form.revision}`,
      timing && `Timeline · ${timing}`, answer && form.config.question && `${form.config.question.prompt} · ${answer}`].filter(Boolean);
    leadEvent(db, id, "Quote form", now, intake.join(" · "));
    return { value: { received: true } };
  });
}
