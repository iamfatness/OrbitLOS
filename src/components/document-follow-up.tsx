"use client";

import { useRef, useState } from "react";
import { Copy } from "lucide-react";
import { draftChannels } from "@/lib/communication-templates";
import { needsBorrowerDocument } from "@/lib/document-model";
import type { DraftChannel, Loan, Workspace } from "@/lib/model";
import { Button } from "./ui/button";

export function DocumentFollowUp({ loan, state }: { loan: Loan; state: Workspace }) {
  const [channel, setChannel] = useState<DraftChannel>("Email");
  const [status, setStatus] = useState("");
  const message = useRef<HTMLTextAreaElement>(null);
  const application = state.applications.find((item) => item.loanId === loan.id);
  const borrower = state.contacts.find((contact) => contact.id === loan.contactId);
  const outstanding = state.documentRequests.filter((item) => item.loanId === loan.id && needsBorrowerDocument(item.status));
  if (!borrower || !outstanding.length) return <p className="empty-inline">There are no borrower requests to follow up on.</p>;
  if (!application?.submittedAt) return <p className="empty-inline">The borrower can open the checklist after submitting their 1003.</p>;
  const expiresAt = application.expiresAt;
  if (expiresAt <= new Date().toISOString()) return <p className="empty-inline">Renew the borrower link in the 1003 section before copying this follow-up.</p>;

  const link = new URL(`/apply#${application.token}`, window.location.origin).href;
  const officer = loan.officer || "Your loan team";
  const email = channel === "Email";
  const items = outstanding.map((request) => {
    const description = request.status === "Needs replacement" ? `Replacement ${request.kind.toLowerCase()} · ${request.replacementNote}`
      : [request.kind, request.instructions].filter(Boolean).join(" · ");
    return email ? `• ${description}` : description;
  });
  const draft = email ? `Subject: Documents for your OrbitLOS demo loan\n\nHi ${borrower.name},\n\nPlease open your checklist and attach the fictional samples below.\n\n${items.join("\n")}\n\n${link}\n\nThanks,\n${officer}`
    : `Hi ${borrower.name}, please attach these fictional samples in your OrbitLOS checklist. ${items.join(" | ")}\n${link}\n— ${officer}`;

  async function copy() {
    if (expiresAt <= new Date().toISOString()) {
      setStatus("This borrower link expired. Renew it in the 1003 section.");
      return;
    }
    try {
      await navigator.clipboard.writeText(draft);
      setStatus("Draft copied to clipboard.");
    } catch {
      message.current?.focus();
      message.current?.select();
      setStatus("The draft is selected. Use your device’s copy shortcut.");
    }
  }

  return <div className="communication-preview">
    <div className="section-heading"><h3>Borrower document follow-up</h3><span className="pill">Preview only</span></div>
    <div className="view-toggle" aria-label="Message channel">
      {draftChannels.map((option) => <button key={option} type="button" aria-pressed={channel === option} onClick={() => { setChannel(option); setStatus(""); }}>{option}</button>)}
    </div>
    <dl><div><dt>To</dt><dd>{borrower.name} <span className="muted">{email ? borrower.email : borrower.phone}</span></dd></div></dl>
    <textarea ref={message} readOnly aria-label={`${channel} follow-up preview`} className="communication-message" value={draft} rows={email ? 10 : 6} />
    <Button variant="outline" size="sm" onClick={() => void copy()}><Copy /> Copy {channel.toLowerCase()} follow-up</Button>
    {status && <p className="muted" role="status">{status}</p>}
  </div>;
}
