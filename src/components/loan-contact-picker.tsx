"use client";

import { useEffect, useRef, useState } from "react";
import { readLoanContactOptions } from "@/app/actions";
import { loanContactPickerUnavailable, type LoanContactOption, type LoanContactPage } from "@/lib/loan-contact-picker-model";
import { Button } from "./ui/button";

export function LoanContactPicker({ kind, brokerageId, value, onChange, initialId, initialOption, onHasLoan, onOfficers, initialSearch,
  requireBorrowerChoice = false, disabled = false }: {
  kind: "borrower" | "realtor"; brokerageId: string; value: string; onChange: (id: string) => void;
  initialId: string; initialOption?: LoanContactOption; onHasLoan?: (value: boolean) => void; onOfficers?: (officers: string[]) => void;
  initialSearch?: string; requireBorrowerChoice?: boolean; disabled?: boolean;
}) {
  const [search, setSearch] = useState(initialSearch?.slice(0, 120) ?? "");
  const [chosen, setChosen] = useState<LoanContactOption>();
  const [data, setData] = useState<{ search: string; page?: LoanContactPage; error?: string }>();
  const [retry, setRetry] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const paging = useRef(false);
  const term = search.trim();
  const isBorrower = kind === "borrower";
  const plural = isBorrower ? "borrowers" : "realtors";
  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      void readLoanContactOptions({ kind, search: term, selectedId: initialId || undefined }, brokerageId)
        .catch(() => ({ error: loanContactPickerUnavailable })).then((result) => {
          if (!current) return;
          if ("error" in result) setData({ search: term, error: result.error });
          else {
            setData({ search: term, page: result });
            onHasLoan?.(result.selectedHasLoan);
            onOfficers?.(result.officers);
          }
        });
    }, term ? 180 : 0);
    return () => { current = false; window.clearTimeout(timer); };
  }, [kind, term, initialId, brokerageId, retry, onHasLoan, onOfficers]);

  const current = data?.search === term ? data : undefined;
  const page = current?.page;
  const pinned = [chosen, data?.page?.selected, initialOption].find((option) => option?.id === value);
  const options = [...(page?.options ?? [])];
  if (value && !(requireBorrowerChoice && value === "new") && !options.some(({ id }) => id === value)) {
    options.unshift(pinned ?? { id: value, name: `Selected ${kind}`, detail: "" });
  }

  async function loadMore() {
    if (!page?.next || paging.current) return;
    paging.current = true;
    setLoadingMore(true);
    try {
      const extra = await readLoanContactOptions({ kind, search: term, selectedId: initialId || undefined, after: page.next }, brokerageId)
        .catch(() => ({ error: loanContactPickerUnavailable }));
      setData((latest) => {
        if (latest !== current) return latest;
        if ("error" in extra) return { ...current, search: term, error: extra.error };
        const unique = new Map([...page.options, ...extra.options].map((option) => [option.id, option]));
        return { search: term, page: { ...extra, options: [...unique.values()] } };
      });
    } finally {
      paging.current = false;
      setLoadingMore(false);
    }
  }

  return <div className="record-form">
    <label className="field">Search {plural}<input type="search" value={search} maxLength={120} disabled={disabled}
      placeholder="Name, email, or phone" onChange={(event) => setSearch(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} /></label>
    <label className="field">{isBorrower ? "Borrower contact" : "Realtor partner"}
      <select name={isBorrower ? "contactId" : "partnerId"} value={value} disabled={disabled} onChange={(event) => {
        const id = event.target.value;
        setChosen(options.find((option) => option.id === id));
        onChange(id);
      }}>
        <option value="" disabled={requireBorrowerChoice}>{requireBorrowerChoice ? "Choose a borrower contact" : isBorrower ? "Create a borrower" : "No realtor linked"}</option>
        {options.map((option) => <option key={option.id} value={option.id}>
          {option.name}{option.detail ? ` · ${option.detail}` : ""}
        </option>)}
        {requireBorrowerChoice && <option value="new">Create a new borrower contact</option>}
      </select>
    </label>
    {!current && <p className="muted" role="status">Loading {plural}…</p>}
    {current?.error && <div className="loan-application-actions"><span role="alert">{current.error}</span>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setRetry((value) => value + 1)}>Retry</Button></div>}
    {term && page?.options.length === 0 && <p className="muted" role="status">No {plural} match that search.</p>}
    {page?.next && <div><Button size="sm" variant="outline" disabled={loadingMore || disabled}
      onClick={() => void loadMore()}>Load more {plural}</Button></div>}
  </div>;
}
