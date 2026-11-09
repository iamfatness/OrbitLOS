"use client";

import { dateLabel } from "@/lib/client-retention";
import type { ConversationCursor, ConversationReplyPage } from "@/lib/conversation-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function ConversationReplies({ page, today, after, open, onPage, showOwner }: {
  page: ConversationReplyPage; today: string; after?: ConversationCursor; open: (id: string) => void;
  onPage: (after?: ConversationCursor) => void; showOwner?: boolean;
}) {
  return <section className="work-queue record-form" aria-label="Replies needing attention">
    <div className="section-heading"><h3>Replies needing attention</h3>{page.items.length > 0 &&
      <span className="pill">{page.items.length} on this page</span>}</div>
    {page.items.length ? <ul className="loan-task-list">{page.items.map((reply) => {
      const context = reply.leadId ? "Lead conversation" : reply.loanId ? `${reply.audience} · ${reply.loanName}’s loan` : `${reply.audience} contact conversation`;
      return <li className="loan-task" key={reply.id}>
        <div className="loan-task-copy"><strong>{reply.name}</strong>
          <span>{context}{reply.unread && " · Unread"}{reply.held && " · On hold"}{reply.outreachBlocked && " · Outreach opted out"}</span>
          {showOwner && <span>Processor · {reply.owner}</span>}
          {reply.campaignCallback && <span>Promised callback · {dateTime(reply.campaignCallback.dueAt)} ET</span>}
          {reply.dueOn && <span>Follow-up {reply.dueOn < today ? "overdue since" : "scheduled for"} {dateLabel(reply.dueOn)}</span>}
        </div>
        <Button size="sm" variant="outline" onClick={() => open(reply.id)}
          aria-label={`Open conversation for ${reply.name} · ${context}`}>Open conversation</Button>
      </li>;
    })}</ul> : <p className="muted">{after ? "No more replies on this page." : "No replies need attention."}</p>}
    {(after || page.next) && <div className="loan-application-actions">
      {after && <Button size="sm" variant="outline" onClick={() => onPage()}>Newest replies</Button>}
      {page.next && <Button size="sm" variant="outline" onClick={() => onPage(page.next ?? undefined)}>Older replies</Button>}
    </div>}
  </section>;
}
