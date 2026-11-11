"use client";

import { dateLabel } from "@/lib/client-retention";
import type { ConversationCursor, ConversationReplyPage } from "@/lib/conversation-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function ConversationReplies({ page, today, after, open, onPage, showOwner }: {
  page: ConversationReplyPage; today: string; after?: ConversationCursor; open: (id: string) => void;
  onPage: (after?: ConversationCursor) => void; showOwner?: boolean;
}) {
  return <section className="work-queue record-form" aria-label="Replies and missed calls">
    <div className="section-heading"><h3>Replies and missed calls</h3>{page.items.length > 0 &&
      <span className="pill">{page.items.length} on this page</span>}</div>
    {page.items.length ? <ul className="loan-task-list">{page.items.map((reply) => {
      const context = reply.leadId ? "Lead conversation" : reply.loanId ? `${reply.audience} · ${reply.loanName}’s loan` : `${reply.audience} contact conversation`;
      return <li className="loan-task conversation-reply-task" key={reply.id}>
        <div className="loan-task-copy"><strong>{reply.name}</strong>
          <span>{reply.missedCall && "Missed call · "}{context}{reply.unread && " · Unread"}{reply.held && " · On hold"}{reply.outreachBlocked && " · Outreach opted out"}</span>
          {showOwner && <span>Processor · {reply.owner}</span>}
          {reply.campaignCallback && <span>Promised callback · {dateTime(reply.campaignCallback.dueAt)} ET</span>}
          {reply.dueOn && <span>Follow-up {reply.dueOn < today ? "overdue since" : "scheduled for"} {dateLabel(reply.dueOn)}</span>}
        </div>
        <Button size="sm" variant="outline" data-conversation-origin={`thread:${reply.id}`} onClick={() => open(reply.id)}
          aria-label={`Open conversation for ${reply.name} · ${context}`}>Open conversation</Button>
      </li>;
    })}</ul> : <p className="muted">{after ? "No more items on this page." : "No replies or missed calls need attention."}</p>}
    {(after || page.next) && <div className="loan-application-actions">
      {after && <Button size="sm" variant="outline" onClick={() => onPage()}>Newest items</Button>}
      {page.next && <Button size="sm" variant="outline" onClick={() => onPage(page.next ?? undefined)}>Older items</Button>}
    </div>}
  </section>;
}
