"use client";

import { useEffect, useRef, useState } from "react";
import { reviewContactMerge } from "@/app/actions";
import type { ContactMergeCursor, DuplicateGroups, DuplicateHistory, DuplicateMembers, DuplicateScan } from "@/lib/contact-merge-model";
import type { Contact } from "@/lib/model";
import { dateTime } from "@/lib/utils";
import { ContactDuplicateReview } from "./contact-duplicate-review";
import { Button } from "./ui/button";

type Query = { type: "duplicateGroups"; after?: string } | { type: "duplicateMembers"; key: string; after?: string; firstRevision?: string } |
  { type: "duplicateHistory"; after?: ContactMergeCursor };
type Page = DuplicateGroups | DuplicateMembers | DuplicateHistory | DuplicateScan | { error: string };
type Decision = { type: "keepDuplicatesSeparate"; key: string; revision: string; reason: string } |
  { type: "reopenDuplicates"; reviewId: string };

function groupName(key: string) {
  return key.startsWith("email:") ? `Email · ${key.slice(6)}` : `Phone · ${key.slice(6)}`;
}

export function ContactDuplicateQueue({ brokerageId, onSaved, openContact }: {
  brokerageId: string; onSaved: () => void; openContact: (id: string) => void;
}) {
  const [query, setQuery] = useState<Query>({ type: "duplicateGroups" });
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ query: Query; revision: number; page: Page }>();
  const [groupAfter, setGroupAfter] = useState<string>();
  const [anchor, setAnchor] = useState<Contact>();
  const [pair, setPair] = useState<[Contact, Contact]>();
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [decisionError, setDecisionError] = useState("");
  const attempt = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => {
    let active = true;
    const fallback = { error: "Could not load possible duplicates. Try refreshing." };
    void reviewContactMerge(query, brokerageId).then((response) => {
      if (active) setResult({ query, revision, page: "error" in response || response.kind === query.type ||
        response.kind === "duplicateScan" ? response : fallback });
    }, () => { if (active) setResult({ query, revision, page: fallback }); });
    return () => { active = false; };
  }, [brokerageId, query, revision]);

  function backToGroups() {
    setQuery({ type: "duplicateGroups", after: groupAfter });
    setAnchor(undefined);
    setPair(undefined);
    setDecisionError("");
  }

  async function saveDecision(decision: Decision) {
    if (working) return;
    setWorking(true);
    setNotice("");
    setDecisionError("");
    const key = JSON.stringify(decision);
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    try {
      const response = await reviewContactMerge({ ...decision, operationId: attempt.current.id }, brokerageId);
      if ("error" in response) setDecisionError(response.error);
      else if (response.kind === "duplicateReviewed") {
        setNotice("Decision recorded. The contacts will stay separate.");
        backToGroups();
      } else if (response.kind === "duplicateReopened") {
        setNotice("Match returned to the duplicate queue.");
        setRevision((value) => value + 1);
      } else setDecisionError("Could not confirm the decision. Try again.");
    } catch { setDecisionError("Could not confirm the decision. Try again."); }
    finally { setWorking(false); }
  }
  const page = result?.query === query && result.revision === revision ? result.page : undefined;
  const group = query.type === "duplicateMembers" ? query.key : null;
  const history = query.type === "duplicateHistory";
  const memberPage = page && "kind" in page && page.kind === "duplicateMembers" ? page : undefined;
  const first = anchor ?? memberPage?.contacts[0];
  const groupChanged = query.type === "duplicateMembers" && query.firstRevision && memberPage && query.firstRevision !== memberPage.revision;

  return <section className="record-form" aria-label="Possible duplicate contacts">
    {notice && <p role="status">{notice}</p>}
    {decisionError && <p role="alert">{decisionError}</p>}
    {pair ? <>
      <div><Button size="sm" variant="outline" onClick={backToGroups}>Back to duplicate queue</Button></div>
      <ContactDuplicateReview contact={pair[0]} contacts={[pair[1]]} brokerageId={brokerageId} onSaved={onSaved} onMerged={openContact} />
    </> : <>
      <p className="muted">{group ? groupName(group) : history ? "See why contacts were kept separate and when matches returned to review." :
        "Review contacts that share an email or phone before starting outreach."}</p>
      <div className="loan-application-actions">
        {(group || history) && <Button size="sm" variant="outline" disabled={working} onClick={backToGroups}>Back to duplicate queue</Button>}
        {query.type === "duplicateGroups" && <Button size="sm" variant="outline" onClick={() => {
          setGroupAfter(query.after);
          setQuery({ type: "duplicateHistory" });
        }}>Review history</Button>}
        <Button size="sm" variant="outline" disabled={!page || working} onClick={() => {
          setDecisionError("");
          if (group && query.after) {
            setAnchor(undefined);
            setQuery({ type: "duplicateMembers", key: group });
          } else setRevision((value) => value + 1);
        }}>
          {page && "kind" in page && page.kind === "duplicateScan" ? "Continue scanning" : "Refresh matches"}
        </Button>
      </div>
      {!page && <p role="status">Looking for matching contacts…</p>}
      {page && "error" in page && <p role="alert">{page.error}</p>}
      {page && "kind" in page && page.kind === "duplicateScan" && <p role="status">
        Orbit is indexing an existing contact list. Continue scanning to finish checking for matches.
      </p>}
      {page && "kind" in page && page.kind === "duplicateGroups" && query.type === "duplicateGroups" && <>
        {page.rows.length ? <ul className="loan-task-list">{page.rows.map((row) => <li className="document-item record-form" key={row.key}>
          <div className="loan-task-copy"><strong>{row.names.join(" · ")}{row.more && " · and others"}</strong><span>{groupName(row.key)}</span></div>
          <div><Button size="sm" variant="outline" onClick={() => {
            setGroupAfter(query.after);
            setQuery({ type: "duplicateMembers", key: row.key });
          }}>Review matches</Button></div>
        </li>)}</ul> : <p className="empty-inline">{query.after ? "No more possible duplicates on this page." : "No matches need review."}</p>}
        <div className="loan-application-actions">
          {query.after && <Button size="sm" variant="outline" onClick={() => setQuery({ type: "duplicateGroups" })}>First groups</Button>}
          {page.next && <Button size="sm" variant="outline" onClick={() => setQuery({ type: "duplicateGroups", after: page.next ?? undefined })}>More groups</Button>}
        </div>
      </>}
      {page && "kind" in page && page.kind === "duplicateHistory" && <>
        {page.rows.length ? <ul className="loan-task-list">{page.rows.map((row) => <li className="document-item record-form" key={row.reviewId}>
          <div className="loan-task-copy">
            <strong>{row.names.join(" · ")}{row.more && " · and others"}</strong><span>{groupName(row.key)}</span>
          </div>
          <p className="muted">Kept separate by {row.actor} · {dateTime(row.at)} ET</p>
          <p>{row.reason}</p>
          {row.reopenedAt ? <p className="muted">{row.reopenedBy ? `Returned by ${row.reopenedBy}` : "Returned after contact changes"} · {dateTime(row.reopenedAt)} ET</p> :
            <div><Button size="sm" variant="outline" disabled={working} onClick={() => void saveDecision({
              type: "reopenDuplicates", reviewId: row.reviewId,
            })}>Return to review</Button></div>}
        </li>)}</ul> : <p className="empty-inline">No keep-separate decisions on this page.</p>}
        <div className="loan-application-actions">
          {query.after && <Button size="sm" variant="outline" disabled={working} onClick={() => setQuery({ type: "duplicateHistory" })}>Newest decisions</Button>}
          {page.next && <Button size="sm" variant="outline" disabled={working} onClick={() => setQuery({
            type: "duplicateHistory", after: page.next ?? undefined,
          })}>Older decisions</Button>}
        </div>
      </>}
      {memberPage && group && <>
          {groupChanged && <p role="status">This group changed while you were reviewing it. Return to the first contacts to review the current group.</p>}
          {first && <p>Comparing with <strong>{first.name}</strong>. Choose another record to review, or set a different first record.</p>}
          {!memberPage.contacts.length && <p className="empty-inline">No matching records on this page.</p>}
          {memberPage.contacts.length === 1 && !query.after && <p className="empty-inline">Only one matching contact remains.</p>}
          <ul className="loan-task-list">{memberPage.contacts.map((contact) => <li className="document-item record-form" key={contact.id}>
            <div className="loan-task-copy"><strong>{contact.name}</strong><span>{contact.role} · {contact.email || "No email"} · {contact.phone || "No phone"}</span></div>
            {first && contact.id !== first.id && <div className="loan-application-actions">
              <Button size="sm" variant="outline" disabled={working} onClick={() => setPair([first, contact])}>Compare {contact.name}</Button>
              <Button size="sm" variant="ghost" disabled={working} onClick={() => setAnchor(contact)}>Set as first record</Button>
            </div>}
          </li>)}</ul>
          <div className="loan-application-actions">
            {query.after && <Button size="sm" variant="outline" disabled={working} onClick={() => {
              setAnchor(undefined);
              setQuery({ type: "duplicateMembers", key: group });
            }}>First contacts</Button>}
            {memberPage.next && <Button size="sm" variant="outline" disabled={working} onClick={() => {
              setAnchor(first);
              setQuery({ type: "duplicateMembers", key: group, after: memberPage.next ?? undefined,
                firstRevision: query.type === "duplicateMembers" ? query.firstRevision ?? memberPage.revision ?? undefined : undefined });
            }}>More contacts</Button>}
          </div>
          {memberPage.reviewed && <p className="empty-inline">This group was already reviewed. See the decision in Review history.</p>}
          {memberPage.revision && !memberPage.reviewed && !groupChanged && <details className="loan-task-create" key={memberPage.revision}>
            <summary>Keep these contacts separate</summary>
            <form className="record-form" onSubmit={(event) => {
              event.preventDefault();
              const reason = new FormData(event.currentTarget).get("reason");
              if (memberPage.revision && typeof reason === "string") void saveDecision({
                type: "keepDuplicatesSeparate", key: group, revision: memberPage.revision, reason,
              });
            }}>
              <p>This decision covers every contact in the group. Review all pages before saving.</p>
              <label className="field">Reason<textarea name="reason" rows={2} maxLength={300} required disabled={working} /></label>
              <div><Button size="sm" type="submit" variant="outline" disabled={working}>Record keep-separate decision</Button></div>
            </form>
          </details>}
      </>}
    </>}
  </section>;
}
