"use client";

import { useState, type ReactNode } from "react";
import { newYorkApplicationFacts, type NewYorkApplicationFacts as Facts } from "@/lib/new-york-application-log-model";
import type { NewYorkApplicationLogResult } from "@/lib/new-york-application-log";
import { RegisterChoice } from "./retention-register-fields";
import { Button } from "./ui/button";

type Entry = Extract<NewYorkApplicationLogResult, { kind: "newYorkApplicationLogHistory" }>["versions"][number];
const outcomes = ["Pending", "Closed", "Denied", "Withdrawn", "Other"] as const;
const feeStatuses = ["Unreviewed", "None", "Recorded", "Accounting record"] as const;
const twoColumns = "grid min-w-0 items-end gap-3 sm:grid-cols-2";
const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function Field({ name, label, value, date, amount, required, limit = 160 }: {
  name: string; label: string; value?: string | number; date?: boolean; amount?: boolean; required?: boolean; limit?: number;
}) {
  return <label className="field min-w-0">{label}{required && " (required)"}
    <input name={name} type={date ? "date" : "text"} defaultValue={value} required={required}
      {...(date ? { min: "1900-01-01", max: "2199-12-31" } : { maxLength: limit })}
      {...(amount ? { inputMode: "decimal", pattern: "[0-9]+([.][0-9]{1,2})?", title: "Enter dollars with up to two decimal places." } : {})} />
  </label>;
}

function Party({ prefix, party }: { prefix: string; party?: { name: string; address: string; description?: string } }) {
  return <div className="record-form">
    <div className={twoColumns}>
      <Field name={prefix + "-name"} label="Name" value={party?.name} required />
      <Field name={prefix + "-description"} label="Description" value={party?.description} required />
    </div>
    <Field name={prefix + "-address"} label="Address" value={party?.address} required limit={300} />
  </div>;
}

function RepeatedFields({ count, setCount, name, min = 1, max, children }: {
  count: number; setCount: (value: number) => void; name: string; min?: number; max: number; children: (index: number) => ReactNode;
}) {
  return <div className="record-form">
    {Array.from({ length: count }, (_, index) => <fieldset className="record-form min-w-0 rounded-lg border border-[var(--line)] p-3" key={index}>
      <legend className="px-1 font-medium">{name} {index + 1}</legend>
      {children(index)}
    </fieldset>)}
    <div className="loan-application-actions">
      <Button type="button" variant="outline" className="min-h-11" disabled={count >= max} onClick={() => setCount(count + 1)}>Add {name.toLowerCase()}</Button>
      {count > min && <Button type="button" variant="outline" className="min-h-11" onClick={() => setCount(count - 1)}>Remove last {name.toLowerCase()}</Button>}
    </div>
  </div>;
}

function FeeReference({ prefix, fee }: { prefix: string; fee?: Facts["preclosingFees"] | Facts["brokerageFees"] }) {
  return <Field name={prefix + "-reference"} label="Fee record reference" value={fee && "reference" in fee ? fee.reference : undefined} required limit={240} />;
}

export function NewYorkApplicationLogForm({ initial, busy, save, cancel }: {
  initial?: Facts; busy: boolean; save: (data: { facts: Facts; correction?: string }) => void; cancel: () => void;
}) {
  const [source, setSource] = useState<Facts["source"]["status"]>(initial?.source.status ?? "Unreviewed");
  const [outcome, setOutcome] = useState<typeof outcomes[number]>(initial?.disposition.status === "Final" ? initial.disposition.outcome : "Pending");
  const [placement, setPlacement] = useState<Facts["placement"]["status"]>(initial?.placement.status ?? "Unreviewed");
  const [preclosing, setPreclosing] = useState<Facts["preclosingFees"]["status"]>(initial?.preclosingFees.status ?? "Unreviewed");
  const [brokerage, setBrokerage] = useState<Facts["brokerageFees"]["status"]>(initial?.brokerageFees.status ?? "Unreviewed");
  const [applicants, setApplicants] = useState(initial?.applicants.length ?? 1);
  const [preclosingCount, setPreclosingCount] = useState(initial?.preclosingFees.status === "Recorded" ? initial.preclosingFees.items.length : 1);
  const [brokerageCount, setBrokerageCount] = useState(initial?.brokerageFees.status === "Recorded" ? initial.brokerageFees.items.length : 1);
  const [error, setError] = useState("");

  function submit(form: FormData) {
    const read = (key: string) => String(form.get(key) ?? "").trim();
    const party = (key: string) => ({ name: read(key + "-name"), address: read(key + "-address"), description: read(key + "-description") });
    const cents = (key: string) => {
      const [whole, fraction = ""] = read(key).split(".");
      return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    };
    const earlierOn = read("earlierOn");
    const earlierReference = read("earlierReference");
    const facts = newYorkApplicationFacts.safeParse({
      fileNumber: read("fileNumber"), office: read("office"), applicationOn: read("applicationOn"), propertyAddress: read("propertyAddress"),
      applicants: Array.from({ length: applicants }, (_, index) => ({
        name: read(`applicant-${index}-name`), address: read(`applicant-${index}-address`),
      })),
      source: source === "Direct" ? { status: source, description: read("sourceDescription") } :
        source === "Referral" ? { status: source, referrer: party("referral") } :
        source === "Accounting record" ? { status: source, reference: read("sourceReference") } : { status: source },
      disposition: outcome === "Pending" ? { status: "Pending" } : {
        status: "Final", outcome, on: read("dispositionOn"), reference: read("dispositionReference"),
      },
      placement: placement === "Placed" ? { status: placement, entity: read("placementEntity") } :
        placement === "Unreviewed" ? { status: placement } : { status: placement, reference: read("placementReference") },
      preclosingFees: preclosing === "Recorded" ? { status: preclosing, items: Array.from({ length: preclosingCount }, (_, index) => {
        const key = "preclosing-" + index;
        return { amountCents: cents(key + "-amount"), paidOn: read(key + "-date"), purpose: read(key + "-purpose"),
          direction: read(key + "-direction"), counterparty: party(key) };
      }) } : preclosing === "Unreviewed" ? { status: preclosing } : { status: preclosing, reference: read("preclosing-reference") },
      brokerageFees: brokerage === "Recorded" ? { status: brokerage, items: Array.from({ length: brokerageCount }, (_, index) => {
        const key = "brokerage-" + index;
        return { amountCents: cents(key + "-amount"), source: read(key + "-source"), sourceType: read(key + "-type") };
      }) } : brokerage === "Unreviewed" ? { status: brokerage } : { status: brokerage, reference: read("brokerage-reference") },
      earlierLog: earlierOn || earlierReference ? { on: earlierOn, reference: earlierReference } : undefined,
    });
    if (!facts.success) {
      const issue = facts.error.issues[0];
      const messages: Record<string, string> = {
        earlierLog: "Enter the earlier log date and its evidence reference.",
        source: "Complete the application source or its accounting reference.",
        disposition: "Complete the outcome date and evidence reference.",
        placement: "Enter the placement entity or evidence reference.",
        preclosingFees: "Check the dates, positive amounts, parties and references in preclosing fees.",
        brokerageFees: "Check the positive amounts, sources and references in brokerage compensation.",
      };
      setError(issue.code === "custom" ? issue.message : messages[String(issue.path[0])] ?? "Check the application fields and required values.");
      return;
    }
    const correction = read("correction");
    if (initial && correction.length < 4) { setError("Enter a correction reason of at least four characters."); return; }
    setError("");
    save({ facts: facts.data, correction: correction || undefined });
  }

  return <form className="record-form w-full max-w-3xl" onInvalid={event => {
    const group = (event.target as HTMLElement).closest("details");
    if (group) group.open = true;
  }} onSubmit={event => { event.preventDefault(); submit(new FormData(event.currentTarget)); }}>
    {error && <p role="alert" tabIndex={-1} ref={node => node?.focus()}>{error}</p>}
    <fieldset className="record-form min-w-0" disabled={busy}>
      <div className={twoColumns}>
        <Field name="fileNumber" label="File number" value={initial?.fileNumber} required limit={100} />
        <Field name="applicationOn" label="Application received" value={initial?.applicationOn} date required />
        <Field name="office" label="Principal or originating branch office" value={initial?.office} required />
        <Field name="propertyAddress" label="Property address" value={initial?.propertyAddress} required limit={300} />
      </div>
      <RepeatedFields name="Applicant" count={applicants} setCount={setApplicants} max={12}>
        {index => <div className={twoColumns}>
          <Field name={`applicant-${index}-name`} label="Applicant name" value={initial?.applicants[index]?.name} required />
          <Field name={`applicant-${index}-address`} label="Applicant address" value={initial?.applicants[index]?.address} required limit={300} />
        </div>}
      </RepeatedFields>
      <RegisterChoice label="Application source" value={source} options={["Unreviewed", "Direct", "Referral", "Accounting record"]} change={setSource} />
      {source === "Direct" && <Field name="sourceDescription" label="Source description" value={initial?.source.status === "Direct" ? initial.source.description : undefined} required />}
      {source === "Referral" && <Party prefix="referral" party={initial?.source.status === "Referral" ? initial.source.referrer : undefined} />}
      {source === "Accounting record" && <Field name="sourceReference" label="Source accounting reference" value={initial?.source.status === "Accounting record" ? initial.source.reference : undefined} required limit={240} />}
      <div className={twoColumns}>
        <RegisterChoice label="Application outcome" value={outcome} options={outcomes} change={setOutcome} />
        <RegisterChoice label="Loan placement" value={placement} options={["Unreviewed", "Placed", "Not placed", "Accounting record"]} change={setPlacement} />
      </div>
      {outcome !== "Pending" && <div className={twoColumns}>
        <Field name="dispositionOn" label="Outcome date" value={initial?.disposition.status === "Final" ? initial.disposition.on : undefined} date required />
        <Field name="dispositionReference" label="Outcome evidence reference" value={initial?.disposition.status === "Final" ? initial.disposition.reference : undefined} required limit={240} />
      </div>}
      {placement === "Placed" && <Field name="placementEntity" label="Placement entity" value={initial?.placement.status === "Placed" ? initial.placement.entity : undefined} required />}
      {(placement === "Not placed" || placement === "Accounting record") && <Field name="placementReference" label="Placement evidence reference"
        value={initial && "reference" in initial.placement ? initial.placement.reference : undefined} required limit={240} />}
      <details className="details-section" open={!!initial && initial.preclosingFees.status !== "Unreviewed"}>
        <summary className="min-h-11 content-center">Preclosing fees</summary>
        <div className="record-form">
          <RegisterChoice label="Preclosing fee evidence" value={preclosing} options={feeStatuses} change={setPreclosing} />
          {(preclosing === "None" || preclosing === "Accounting record") && <FeeReference prefix="preclosing" fee={initial?.preclosingFees} />}
          {preclosing === "Recorded" && <RepeatedFields name="Preclosing fee" count={preclosingCount} setCount={setPreclosingCount} max={100}>
            {index => {
              const key = "preclosing-" + index;
              const fee = initial?.preclosingFees.status === "Recorded" ? initial.preclosingFees.items[index] : undefined;
              return <>
                <div className={twoColumns}>
                  <Field name={key + "-amount"} label="Amount in USD" value={fee && fee.amountCents / 100} amount required limit={12} />
                  <Field name={key + "-date"} label="Date paid" value={fee?.paidOn} date required />
                  <label className="field">Direction<select name={key + "-direction"} defaultValue={fee?.direction}><option>Collected</option><option>Distributed</option></select></label>
                  <Field name={key + "-purpose"} label="Purpose" value={fee?.purpose} required />
                </div>
                <Party prefix={key} party={fee?.counterparty} />
              </>;
            }}
          </RepeatedFields>}
        </div>
      </details>
      <details className="details-section" open={!!initial && initial.brokerageFees.status !== "Unreviewed"}>
        <summary className="min-h-11 content-center">Brokerage compensation</summary>
        <div className="record-form">
          <RegisterChoice label="Brokerage compensation evidence" value={brokerage} options={feeStatuses} change={setBrokerage} />
          {(brokerage === "None" || brokerage === "Accounting record") && <FeeReference prefix="brokerage" fee={initial?.brokerageFees} />}
          {brokerage === "Recorded" && <RepeatedFields name="Compensation payment" count={brokerageCount} setCount={setBrokerageCount} max={100}>
            {index => {
              const key = "brokerage-" + index;
              const fee = initial?.brokerageFees.status === "Recorded" ? initial.brokerageFees.items[index] : undefined;
              return <>
                <div className={twoColumns}>
                  <Field name={key + "-amount"} label="Amount in USD" value={fee && fee.amountCents / 100} amount required limit={12} />
                  <label className="field">Source type<select name={key + "-type"} defaultValue={fee?.sourceType}>
                    {["Applicant", "Lender", "Broker", "Other"].map(type => <option key={type}>{type}</option>)}
                  </select></label>
                </div>
                <Field name={key + "-source"} label="Paying party" value={fee?.source} required />
              </>;
            }}
          </RepeatedFields>}
        </div>
      </details>
      <details className="details-section" open={!!initial?.earlierLog}>
        <summary className="min-h-11 content-center">Earlier log evidence</summary>
        <div className={twoColumns}>
          <Field name="earlierOn" label="Earlier log date" value={initial?.earlierLog?.on} date />
          <Field name="earlierReference" label="Earlier log reference" value={initial?.earlierLog?.reference} limit={240} />
        </div>
      </details>
      {initial && <Field name="correction" label="Correction reason" required limit={240} />}
      <div className="loan-application-actions">
        <Button type="submit" className="min-h-11">{busy ? "Saving…" : "Save application entry"}</Button>
        <Button type="button" variant="outline" className="min-h-11" onClick={cancel}>Cancel</Button>
      </div>
    </fieldset>
  </form>;
}

export function NewYorkApplicationEvidence({ entry }: { entry: Entry }) {
  const { facts, review } = entry;
  const rows: [string, string | undefined][] = [
    ["Originating office", facts.office], ["Received", facts.applicationOn], ["Property address", facts.propertyAddress],
    ...facts.applicants.map((applicant, index): [string, string] => [`Applicant ${index + 1}`, `${applicant.name} · ${applicant.address}`]),
    ["Source", facts.source.status],
    ["Source details", facts.source.status === "Direct" ? facts.source.description : facts.source.status === "Referral" ?
      `${facts.source.referrer.name} · ${facts.source.referrer.address} · ${facts.source.referrer.description}` :
      facts.source.status === "Accounting record" ? facts.source.reference : undefined],
    ["Outcome", facts.disposition.status === "Final" ? facts.disposition.outcome : "Pending"],
    ["Outcome date", facts.disposition.status === "Final" ? facts.disposition.on : undefined],
    ["Outcome evidence", facts.disposition.status === "Final" ? facts.disposition.reference : undefined],
    ["Placement", facts.placement.status === "Placed" ? facts.placement.entity : facts.placement.status],
    ["Placement evidence", "reference" in facts.placement ? facts.placement.reference : undefined],
    ["Preclosing fees", "reference" in facts.preclosingFees ? `${facts.preclosingFees.status} · ${facts.preclosingFees.reference}` : facts.preclosingFees.status],
    ["Brokerage compensation", "reference" in facts.brokerageFees ? `${facts.brokerageFees.status} · ${facts.brokerageFees.reference}` : facts.brokerageFees.status],
    ["First documented entry", review.firstLoggedOn], ["Earlier log reference", facts.earlierLog?.reference],
    ["Correction reason", entry.correction ?? undefined],
  ];
  return <div className="record-form">
    <p>{entry.actor} · {new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium" }).format(new Date(entry.at))}</p>
    {!!review.gaps.length && <div><strong>Evidence gaps</strong><ul className="list-disc pl-5">{review.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul></div>}
    <dl className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
      {rows.map(([label, value]) => value && <div key={label} className="contents"><dt className="font-medium">{label}</dt>
        <dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd></div>)}
    </dl>
    {facts.preclosingFees.status === "Recorded" && <details className="details-section">
      <summary className="min-h-11 content-center">Preclosing fee details</summary>
      <ul className="list-disc space-y-2 pl-5 [overflow-wrap:anywhere]">{facts.preclosingFees.items.map((fee, index) =>
        <li key={index}>{dollars.format(fee.amountCents / 100)} · {fee.direction} · {fee.paidOn} · {fee.purpose}
          <br />{fee.counterparty.name} · {fee.counterparty.address} · {fee.counterparty.description}</li>)}</ul>
    </details>}
    {facts.brokerageFees.status === "Recorded" && <details className="details-section">
      <summary className="min-h-11 content-center">Brokerage compensation details</summary>
      <ul className="list-disc space-y-2 pl-5 [overflow-wrap:anywhere]">{facts.brokerageFees.items.map((fee, index) =>
        <li key={index}>{dollars.format(fee.amountCents / 100)} · {fee.sourceType} · {fee.source}</li>)}</ul>
    </details>}
  </div>;
}
