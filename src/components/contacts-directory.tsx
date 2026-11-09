"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { readContactsWork } from "@/app/actions";
import { contactsUnavailable, type ContactDirectoryPage } from "@/lib/contact-directory-model";
import { Button } from "./ui/button";

export function ContactsDirectory({ brokerageId, version, admin, busy, openContact, tools }: {
  brokerageId: string; version: object; admin: boolean; busy: boolean;
  openContact: (id: string, edit?: boolean) => void; tools: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<{ query: string; version: object; retry: number; page?: ContactDirectoryPage; error?: string }>();
  const [loadingMore, setLoadingMore] = useState(false);
  const search = query.trim();
  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      void readContactsWork({ type: "list", search }, brokerageId)
        .catch(() => ({ error: contactsUnavailable })).then((result) => {
          if (!current) return;
          setData({ query: search, version, retry, ...("kind" in result && result.kind === "list" ?
            { page: result } : { error: "error" in result ? result.error : contactsUnavailable }) });
        });
    }, search ? 180 : 0);
    return () => { current = false; window.clearTimeout(timer); };
  }, [search, brokerageId, version, retry]);

  const current = data?.query === search && data.version === version && data.retry === retry ? data : undefined;
  const page = current?.page;
  async function loadMore() {
    if (!current || !page?.next || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await readContactsWork({ type: "list", search, after: page.next }, brokerageId)
        .catch(() => ({ error: contactsUnavailable }));
      setData((latest) => {
        if (latest !== current) return latest;
        if (!("kind" in result) || result.kind !== "list") {
          return { ...current, error: "error" in result ? result.error : contactsUnavailable };
        }
        const rows = new Map(page.rows.map((contact) => [contact.id, contact]));
        for (const contact of result.rows) rows.set(contact.id, contact);
        return { ...current, error: undefined, page: { ...result, rows: [...rows.values()] } };
      });
    } finally {
      setLoadingMore(false);
    }
  }

  return <section className="pipeline" aria-label="Contacts directory">
    <div className="pipeline-heading"><div><h2>All contacts</h2><p>Your borrowers and referral partners.</p></div></div>
    <div className="toolbar">
      <label className="search"><Search size={17} /><input aria-label="Search contacts" placeholder="Search contacts…"
        maxLength={120} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      {tools}
    </div>
    {!current && <p className="empty-inline" role="status">Loading contacts…</p>}
    {current?.error && <div className="toolbar" role="alert">{current.error}
      {!page && <Button size="sm" variant="outline" onClick={() => setRetry((value) => value + 1)}>Retry</Button>}
    </div>}
    {page && (page.rows.length ? <>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Name</th><th>Contact type</th><th>Email</th><th>Phone</th></tr></thead><tbody>
        {page.rows.map((contact) => <tr key={contact.id}>
          <td><button className="name-link" disabled={busy} onClick={() => openContact(contact.id)}>{contact.name}</button>
            {admin && <small><button className="name-link" disabled={busy} onClick={() => openContact(contact.id, true)}>Edit contact</button></small>}</td>
          <td>{contact.role}</td><td>{contact.email || "—"}</td><td>{contact.phone || "—"}</td>
        </tr>)}
      </tbody></table></div>
      <div className="toolbar"><span className="muted" role="status">{page.rows.length} {page.rows.length === 1 ? "contact" : "contacts"} shown</span>
        {page.next && <Button variant="outline" size="sm" disabled={loadingMore || busy} onClick={() => void loadMore()}>
          {loadingMore ? "Loading contacts…" : "Load more contacts"}
        </Button>}
      </div>
    </> : <p className="empty-inline no-matches">{search ? "No contacts match your search." :
      admin ? "No contacts yet. Add a contact or import a CSV to get started." : "No contacts are available in your workspace yet."}</p>)}
  </section>;
}
