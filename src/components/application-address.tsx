import { useEffect, useRef, useState } from "react";
import { sampleAddresses, usZip, type AddressDetails, type AddressLocation, type AddressStreet, type ApplicationDraft } from "@/lib/application-model";

export type UpdateDraft = (changes: (current: ApplicationDraft) => Partial<ApplicationDraft>) => void;
type CityState = Pick<AddressLocation, "city" | "state">;

export function ApplicationAddress({ street, details, label, required, draft, update }: {
  street: AddressStreet; details: AddressDetails; label: string; required?: boolean; draft: ApplicationDraft; update: UpdateDraft;
}) {
  const location = draft[details];
  const [notice, setNotice] = useState("");
  const lookup = useRef<AbortController | null>(null);
  const lastSuggestion = useRef<CityState | null>(null);
  const query = draft[street].trim().toLowerCase();
  const suggestions = query.length >= 3 ? sampleAddresses.filter((address) =>
    address.street.toLowerCase().includes(query) && (address.street.toLowerCase() !== query || address.location.zip !== location.zip)) : [];

  useEffect(() => () => lookup.current?.abort(), []);

  function setLocation<K extends keyof AddressLocation>(key: K, value: AddressLocation[K]) {
    update((current) => ({ [details]: { ...current[details], [key]: value } }));
  }

  function changeZip(value: string) {
    const zip = value.trim();
    if (zip.slice(0, 5) === location.zip.slice(0, 5) && /^\d{5}/.test(location.zip)) {
      setLocation("zip", zip);
      return;
    }

    lookup.current?.abort();
    setNotice("");
    const previous = lastSuggestion.current;
    lastSuggestion.current = null;
    update((current) => ({
      [details]: {
        ...current[details], zip,
        city: current[details].city === previous?.city ? "" : current[details].city,
        state: current[details].state === previous?.state ? "" : current[details].state,
      },
    }));
    if (usZip.test(zip)) void lookupZip(zip);
  }

  async function lookupZip(zip: string) {
    lookup.current?.abort();
    const controller = new AbortController();
    lookup.current = controller;
    try {
      const response = await fetch(`/api/zip-city-state?zip=${zip.slice(0, 5)}`, { signal: controller.signal });
      if (!response.ok) throw new Error("Lookup unavailable");
      const suggestion: CityState = await response.json();
      if (controller.signal.aborted) return;
      lastSuggestion.current = suggestion;
      update((current) => {
        const saved = current[details];
        if (saved.zip.slice(0, 5) !== zip.slice(0, 5)) return {};
        return { [details]: { ...saved, city: saved.city || suggestion.city, state: saved.state || suggestion.state } };
      });
      setNotice(`ZIP suggestion: ${suggestion.city}, ${suggestion.state}. City and state are editable.`);
    } catch {
      if (!controller.signal.aborted) setNotice("No ZIP suggestion available. Enter city and state manually.");
    }
  }

  return <div className="application-address" role="group" aria-labelledby={`${street}-label`}>
    <h3 id={`${street}-label`}>{label}{!required && " (optional)"}</h3>
    <div className="form-grid">
      <label className="field"><span>Street address</span>
        <input value={draft[street]} required={required} maxLength={street === "propertyAddress" ? 240 : 160} autoComplete="off"
          onChange={(event) => { const value = event.target.value; update(() => ({ [street]: value })); }} />
      </label>
      <label className="field"><span>Apt or unit (optional)</span>
        <input value={location.unit} maxLength={30} autoComplete="off" onChange={(event) => setLocation("unit", event.target.value)} />
      </label>
      {suggestions.length > 0 && <div className="application-address-suggestions">
        <small>Fictional demo address suggestions</small>
        {suggestions.map((suggestion) => <button type="button" key={suggestion.street} onClick={() => {
          lookup.current?.abort();
          lastSuggestion.current = null;
          update(() => ({ [street]: suggestion.street, [details]: suggestion.location }));
          setNotice("Sample address filled. You can edit any field.");
        }}>{suggestion.street}, {suggestion.location.city}, {suggestion.location.state} {suggestion.location.zip}</button>)}
      </div>}
      <label className="field"><span>ZIP code</span>
        <input value={location.zip} required={required} maxLength={10} autoComplete="off" inputMode="numeric"
          onChange={(event) => changeZip(event.target.value)} />
      </label>
      <label className="field"><span>City</span>
        <input value={location.city} required={required} maxLength={100} autoComplete="off" onChange={(event) => setLocation("city", event.target.value)} />
      </label>
      <label className="field"><span>State (two-letter code)</span>
        <input value={location.state} required={required} maxLength={2} autoComplete="off"
          onChange={(event) => setLocation("state", event.target.value.toUpperCase())} />
      </label>
      {usZip.test(location.zip) && <button className="application-zip-retry" type="button" onClick={() => void lookupZip(location.zip)}>Look up city and state</button>}
      {notice && <p className="application-address-notice" role="status">{notice}</p>}
    </div>
  </div>;
}
