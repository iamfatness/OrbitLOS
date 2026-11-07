import type { AddressLocation } from "./application-model";

export type PlaceSuggestion = { id: string; label: string };
type PlaceAddress = { street: string; location: AddressLocation };

async function lookup<T>(body: object, session: string, signal: AbortSignal): Promise<T> {
  const response = await fetch("/api/demo-address", {
    method: "POST", credentials: "omit", signal, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, token: window.location.hash.slice(1), session }),
  });
  if (!response.ok) throw new Error("Address lookup unavailable");
  return response.json();
}

export const searchPlaces = (query: string, zip: string, session: string, signal: AbortSignal) =>
  lookup<PlaceSuggestion[]>({ type: "search", query, zip }, session, signal);
export const selectPlace = (id: string, session: string, signal: AbortSignal) =>
  lookup<PlaceAddress>({ type: "select", id }, session, signal);
