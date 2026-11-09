"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { workOnLoanReview } from "@/app/actions";
import { dateLabel } from "@/lib/client-retention";
import type { ReviewInboxQuery, ReviewNotice, ReviewResult } from "@/lib/loan-review-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

const unreadFirst: ReviewInboxQuery = { type: "inbox", unread: true };
type InboxPage = Extract<ReviewResult, { kind: "inbox" }>;
type InboxData = InboxPage | { error: string };

export function useReviewInbox(brokerageId: string, enabled: boolean, shown: boolean, version: number) {
  const [selection, setSelection] = useState(unreadFirst);
  const [reload, setReload] = useState(0);
  const query = shown ? selection : unreadFirst;
  const [result, setResult] = useState<{ query: ReviewInboxQuery; brokerageId: string; data: InboxData }>();
  const [badge, setBadge] = useState<{ brokerageId: string; label: string }>();

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => setReload((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const failure = { error: "Could not load review notices. Refresh to try again." };
    const firstUnread = query.unread && !query.after;
    function updateBadge(data: InboxData) {
      if (!active || "error" in data) return;
      const label = data.notices.length ? `${data.notices.length}${data.next ? "+" : ""}` : "";
      setBadge({ brokerageId, label });
    }
    function update(data: InboxData) {
      if (!active) return;
      setResult({ query, brokerageId, data });
      if (firstUnread) updateBadge(data);
    }
    void workOnLoanReview(query, brokerageId).then((response) => {
      update("error" in response || response.kind === "inbox" ? response : failure);
    }, () => update(failure));
    if (!firstUnread) void workOnLoanReview(unreadFirst, brokerageId).then((response) => {
      if ("kind" in response && response.kind === "inbox") updateBadge(response);
    }, () => undefined);
    return () => { active = false; };
  }, [brokerageId, enabled, query, reload, shown, version]);

  return { query, setSelection, data: result?.query === query && result.brokerageId === brokerageId ? result.data : undefined,
    unread: badge?.brokerageId === brokerageId ? badge.label : "", refresh: () => setReload((value) => value + 1) };
}

export function ReviewInboxPanel({ inbox, brokerageId, busy, open }: {
  inbox: ReturnType<typeof useReviewInbox>; brokerageId: string; busy: boolean; open: (loanId: string, reviewId: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const { data, query, setSelection, refresh } = inbox;
  const page = data && !("error" in data) ? data : undefined;

  async function read(notice: ReviewNotice, visit: boolean) {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await workOnLoanReview({ type: "readNotice", id: notice.id, reviewId: notice.reviewId }, brokerageId);
      if ("error" in result) setError(result.error);
      else if (result.kind === "noticeRead" && visit) open(result.loanId, result.reviewId);
    } catch { setError("Could not update this review notice. Try again."); }
    finally { pending.current = false; setSaving(false); refresh(); }
  }

  return <section className="integration record-form manager-panel" aria-label="Your review notices">
    <div className="section-heading"><h2>Your review notices</h2>
      <Button size="sm" variant="outline" onClick={refresh}><RefreshCw /> Refresh inbox</Button></div>
    <label className="field">Show notices<select value={query.unread ? "unread" : "all"}
      onChange={(event) => { setError(""); setSelection({ type: "inbox", unread: event.target.value === "unread" }); }}>
      <option value="unread">Unread</option><option value="all">All</option>
    </select></label>
    {error && <p role="alert">{error}</p>}
    {!data && <p className="muted" role="status">Loading review notices…</p>}
    {data && "error" in data && <p role="alert">{data.error}</p>}
    {page && <>
      {page.notices.length ? <ul className="loan-task-list">{page.notices.map((notice) => <li className="loan-task" key={notice.id}>
        <div className="loan-task-copy"><strong>{notice.label} · {notice.title}</strong>
          <span>{notice.borrower} · {notice.status} · Due {dateLabel(notice.dueOn)}</span>
          <span>{notice.actor ? `${notice.actor} · ${dateTime(notice.at)} ET` : "Current review deadline"}{!notice.read && " · Unread"}</span>
        </div>
        <div className="loan-application-actions">
          <Button size="sm" variant="outline" disabled={saving || busy} aria-label={`Open review ${notice.title}`} onClick={() => void read(notice, true)}>Open review</Button>
          {!notice.read && <Button size="sm" variant="ghost" disabled={saving || busy} onClick={() => void read(notice, false)}>Mark read</Button>}
        </div>
      </li>)}</ul> : <p className="empty-inline">{query.unread ? "You’re caught up on review notices." : "Review assignments, decisions, mentions, and current deadlines will appear here."}</p>}
      <div className="loan-application-actions">
        {query.after && <Button size="sm" variant="outline" onClick={() => setSelection({ ...query, after: undefined })}>First page</Button>}
        {page.next && <Button size="sm" variant="outline" onClick={() => setSelection({ ...query, after: page.next ?? undefined })}>Next page</Button>}
      </div>
    </>}
  </section>;
}
