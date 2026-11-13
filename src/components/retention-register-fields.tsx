"use client";

import { useId, type ReactNode } from "react";

export function RegisterField({ label, value, change, date = false, multiline = false, required = false, limit = 160, inputMode }: {
  label: string; value: string | null; change: (value: string) => void; date?: boolean; multiline?: boolean;
  required?: boolean; limit?: number; inputMode?: "numeric" | "decimal";
}) {
  const id = useId();
  return <label className="field min-w-0"><span id={id}>{label}</span>
    {multiline ? <textarea aria-labelledby={id} rows={2} maxLength={limit} required={required} value={value ?? ""}
      onChange={event => change(event.target.value)} /> :
      <input aria-labelledby={id} type={date ? "date" : "text"} inputMode={inputMode} required={required}
        {...(date ? { min: "1900-01-01", max: "2199-12-31" } : { maxLength: limit })}
        value={value ?? ""} onChange={event => change(event.target.value)} />}
  </label>;
}

export function RegisterChoice<T extends string>({ label, value, options, change, optionLabel, disabled }: {
  label: string; value: T; options: readonly T[]; change: (value: T) => void; optionLabel?: (value: T) => string; disabled?: boolean;
}) {
  const id = useId();
  return <label className="field min-w-0"><span id={id}>{label}</span>
    <select aria-labelledby={id} value={value} disabled={disabled} onChange={event => change(event.target.value as T)}>
      {options.map(option => <option key={option} value={option}>{optionLabel?.(option) ?? option}</option>)}
    </select>
  </label>;
}

export function RecordsGroup({ title, children }: { title: string; children: ReactNode }) {
  return <details className="min-w-0 border-t border-[var(--line)]">
    <summary className="min-h-11 content-center">{title}</summary>
    <div className="record-form min-w-0">{children}</div>
  </details>;
}
