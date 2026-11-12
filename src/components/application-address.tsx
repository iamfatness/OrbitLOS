import { useEffect, useId, useRef, useState } from "react";
import { sampleAddresses, usZip, type AddressDetails, type AddressLocation, type AddressStreet, type ApplicationDraft } from "@/lib/application-model";
import { searchPlaces, selectPlace, type PlaceSuggestion } from "@/lib/place-client";

export type UpdateDraft = (changes: (current: ApplicationDraft) => Partial<ApplicationDraft>) => void;
type CityState = Pick<AddressLocation, "city" | "state">;
export type AddressValue = { street: string; location: AddressLocation; country?: string };
type ChangeAddress = (update: (previous: AddressValue) => AddressValue) => void;

export function ApplicationAddress({ street, details, label, required, draft, update, lookupEnabled }: {
  street: AddressStreet; details: AddressDetails; label: string; required?: boolean; draft: ApplicationDraft; update: UpdateDraft; lookupEnabled?: boolean;
}) {
  const addressValue = (application: ApplicationDraft) => ({
    street: application[street], location: application[details], country: street === "propertyAddress" ? undefined : application[details].country ?? "",
  });
  return <AddressEditor label={label} required={required} lookupEnabled={lookupEnabled}
    value={addressValue(draft)}
    maxStreetLength={street === "propertyAddress" ? 240 : 160}
    change={(change) => update((current) => {
      const next = change(addressValue(current));
      return { [street]: next.street, [details]: { ...next.location, country: next.country } };
    })} />;
}

export function AddressEditor({ label, required, value, change, lookupEnabled, maxStreetLength = 240 }: {
  label: string; required?: boolean; value: AddressValue; change: ChangeAddress; lookupEnabled?: boolean; maxStreetLength?: number;
}) {
  const { street, location, country } = value;
  const domestic = !country || /^(US|USA|United States)$/i.test(country.trim());
  const labelId = useId();
  const [notice, setNotice] = useState("");
  const [placesNotice, setPlacesNotice] = useState("");
  const [places, setPlaces] = useState<PlaceSuggestion[]>([]);
  const zipRequest = useRef<AbortController | null>(null);
  const placeRequest = useRef<AbortController | null>(null);
  const session = useRef("");
  const lastSuggestion = useRef<Partial<CityState> | null>(null);
  const query = street.trim();
  const demo = !lookupEnabled && query.length >= 3 ? sampleAddresses.filter((address) =>
    address.street.toLowerCase().includes(query.toLowerCase()) && (address.street.toLowerCase() !== query.toLowerCase() || address.location.zip !== location.zip)) : [];

  useEffect(() => () => {
    zipRequest.current?.abort();
    placeRequest.current?.abort();
  }, []);

  function setLocation(key: keyof AddressLocation, answer: string) {
    if (key === "state") {
      zipRequest.current?.abort();
      setNotice("");
    }
    change((previous) => ({ ...previous, location: { ...previous.location, [key]: answer } }));
  }

  function changeStreet(street: string) {
    placeRequest.current?.abort();
    setPlaces([]);
    setPlacesNotice("");
    change((previous) => ({ ...previous, street }));
  }

  function changeZip(value: string) {
    const zip = value.trim();
    if (zip.slice(0, 5) === location.zip.slice(0, 5) && /^\d{5}/.test(location.zip)) {
      setLocation("zip", zip);
      return;
    }
    zipRequest.current?.abort();
    setNotice("");
    const previous = lastSuggestion.current;
    lastSuggestion.current = null;
    change((address) => ({ ...address, location: {
      ...address.location, zip,
      city: address.location.city === previous?.city ? "" : address.location.city,
      state: address.location.state === previous?.state ? "" : address.location.state,
    } }));
    if (domestic && usZip.test(zip)) void lookupZip(zip,
      location.state === previous?.state ? "" : location.state,
      location.city === previous?.city ? "" : location.city);
  }

  async function lookupZip(zip: string, enteredState = location.state, enteredCity = location.city) {
    zipRequest.current?.abort();
    const controller = new AbortController();
    zipRequest.current = controller;
    try {
      const response = await fetch(`/api/zip-city-state?zip=${zip.slice(0, 5)}`, { signal: controller.signal });
      if (!response.ok) throw new Error("Lookup unavailable");
      const suggestion: CityState = await response.json();
      if (controller.signal.aborted) return;
      if (enteredState && enteredState.trim().toUpperCase() !== suggestion.state) {
        setNotice(`This ZIP lookup returned ${suggestion.state}. Check the ZIP and state before continuing.`);
        return;
      }
      lastSuggestion.current = { city: enteredCity ? undefined : suggestion.city, state: enteredState ? undefined : suggestion.state };
      change((previous) => {
        const saved = previous.location;
        if (saved.zip.slice(0, 5) !== zip.slice(0, 5) || (saved.state && saved.state.trim().toUpperCase() !== suggestion.state)) return previous;
        return { ...previous, location: { ...saved, city: saved.city || suggestion.city, state: saved.state || suggestion.state } };
      });
      setNotice(`ZIP suggestion · ${suggestion.city}, ${suggestion.state}. City and state are editable.`);
    } catch {
      if (!controller.signal.aborted) setNotice("No ZIP suggestion available. Enter city and state manually.");
    }
  }

  async function search() {
    placeRequest.current?.abort();
    const controller = new AbortController();
    placeRequest.current = controller;
    session.current ||= crypto.randomUUID();
    setPlaces([]);
    setPlacesNotice("Searching Google Maps…");
    try {
      const results = await searchPlaces(query, usZip.test(location.zip) ? location.zip : "", session.current, controller.signal);
      if (controller.signal.aborted) return;
      setPlaces(results);
      setPlacesNotice(results.length ? "" : "No matches found. You can enter the address manually.");
    } catch {
      if (!controller.signal.aborted) setPlacesNotice("Street search is unavailable. You can enter the address manually.");
    }
  }

  async function select(suggestion: PlaceSuggestion) {
    placeRequest.current?.abort();
    const controller = new AbortController();
    placeRequest.current = controller;
    const sessionId = session.current;
    session.current = "";
    setPlaces([]);
    setPlacesNotice("Opening the selected address…");
    try {
      const match = await selectPlace(suggestion.id, sessionId, controller.signal);
      if (controller.signal.aborted) return;
      zipRequest.current?.abort();
      lastSuggestion.current = null;
      change((previous) => ({
        ...previous, street: match.street.slice(0, maxStreetLength),
        location: { ...match.location, unit: match.location.unit || previous.location.unit },
      }));
      setNotice("");
      setPlacesNotice("Address filled from Google Maps. Review the fields and add an apartment or unit if needed.");
    } catch {
      if (!controller.signal.aborted) setPlacesNotice("That address could not be filled. You can enter it manually.");
    }
  }

  return <div className="application-address" role="group" aria-labelledby={labelId}>
    <h3 id={labelId}>{label}{!required && " (optional)"}</h3>
    <div className="form-grid">
      <label className="field"><span>Street address</span>
        <input value={street} required={required} maxLength={maxStreetLength} autoComplete="off" onChange={(event) => changeStreet(event.target.value)} />
      </label>
      <label className="field"><span>Apt or unit (optional)</span>
        <input value={location.unit} maxLength={30} autoComplete="off" onChange={(event) => setLocation("unit", event.target.value)} />
      </label>
      {lookupEnabled && domestic && <div className="application-address-suggestions">
        <button type="button" disabled={query.length < 4} onClick={() => void search()}>Search with Google Maps</button>
        <small>Search sends the typed street and ZIP to Google. You can enter it manually. <a className="name-link" href="/address-lookup" target="_blank" rel="noopener noreferrer">Lookup privacy and terms</a></small>
        {places.length > 0 && <div className="application-places-results" aria-label="Google Maps address results">
          {places.map((suggestion) => <button type="button" key={suggestion.id} onClick={() => void select(suggestion)}>{suggestion.label}</button>)}
          <small>Google Maps</small>
        </div>}
        {placesNotice && <p role="status">{placesNotice}</p>}
      </div>}
      {demo.length > 0 && <div className="application-address-suggestions">
        <small>Fictional demo address suggestions</small>
        {demo.map((suggestion) => <button type="button" key={suggestion.street} onClick={() => {
          zipRequest.current?.abort();
          lastSuggestion.current = null;
          change((previous) => ({ ...previous, ...suggestion }));
          setNotice("Sample address filled. You can edit any field.");
        }}>{suggestion.street}, {suggestion.location.city}, {suggestion.location.state} {suggestion.location.zip}</button>)}
      </div>}
      {country !== undefined && <label className="field"><span>Country</span>
        <input value={country} maxLength={100} placeholder="United States" onChange={(event) => {
          const country = event.target.value;
          zipRequest.current?.abort();
          placeRequest.current?.abort();
          setPlaces([]);
          setPlacesNotice("");
          setNotice("");
          change((previous) => ({ ...previous, country }));
        }} />
      </label>}
      <label className="field"><span>{domestic ? "ZIP code" : "Postal code"}</span>
        <input value={location.zip} required={required && domestic} maxLength={domestic ? 10 : 20} autoComplete="off" inputMode={domestic ? "numeric" : "text"}
          onChange={(event) => changeZip(event.target.value)} />
      </label>
      <label className="field"><span>City</span>
        <input value={location.city} required={required} maxLength={100} autoComplete="off" onChange={(event) => setLocation("city", event.target.value)} />
      </label>
      <label className="field"><span>{domestic ? "State (two-letter code)" : "State or province"}</span>
        <input value={location.state} required={required && domestic} maxLength={domestic ? 2 : 100} autoComplete="off"
          onChange={(event) => setLocation("state", domestic ? event.target.value.toUpperCase() : event.target.value)} />
      </label>
      {domestic && usZip.test(location.zip) && (!location.city || !location.state) && <button className="application-zip-retry" type="button" onClick={() => void lookupZip(location.zip)}>Look up city and state</button>}
      {notice && <p className="application-address-notice" role="status">{notice}</p>}
    </div>
  </div>;
}
