import { z } from "zod";
import { borrowerJson } from "./borrower-http";
import type { Store } from "./store";

import { portalTokenPattern } from "./brokerage-model";

const access = { token: z.string().regex(portalTokenPattern), session: z.uuid() };
const addressCommand = z.discriminatedUnion("type", [
  z.object({ type: z.literal("search"), query: z.string().trim().min(4).max(240), zip: z.string().regex(/^(?:\d{5}(?:-\d{4})?)?$/), ...access }),
  z.object({ type: z.literal("select"), id: z.string().regex(/^[A-Za-z0-9_-]{1,240}$/), ...access }),
]);
const predictions = z.object({ suggestions: z.array(z.object({
  placePrediction: z.object({ placeId: z.string(), text: z.object({ text: z.string() }) }),
})).default([]) });
const components = z.object({ addressComponents: z.array(z.object({
  longText: z.string(), shortText: z.string(), types: z.array(z.string()),
})) });
const endpoint = "https://places.googleapis.com/v1";
const windowMs = 15 * 60 * 1000;
const requestsPerWindow = 35;

export function reserveAddressLookup(db: Store, token: string, time = Date.now()) {
  const now = new Date(time).toISOString();
  const window = Math.floor(time / windowMs);
  return db.transaction(() => {
    const application = db.prepare("SELECT loanId FROM applications WHERE token = ? AND expiresAt > ? AND submittedAt IS NULL AND revokedAt IS NULL").get(token, now);
    if (!application) return 404;
    const attempt = db.prepare("SELECT window, requests FROM application_address_quota WHERE loanId = ?").get(application.loanId);
    const requests = attempt?.window === window ? Number(attempt.requests) + 1 : 1;
    if (requests > requestsPerWindow) return 429;
    db.prepare(`INSERT INTO application_address_quota (loanId, window, requests) VALUES (?, ?, ?)
      ON CONFLICT(loanId) DO UPDATE SET window = excluded.window, requests = excluded.requests`).run(application.loanId, window, requests);
    return 200;
  });
}

export function placesHttp(request: Request, key: string, reserve: (token: string) => number | Promise<number>) {
  return borrowerJson<unknown>(request, async (input) => {
    if (!key) return { status: 503, error: "Live street lookup is unavailable. Enter the address manually." };
    const command = addressCommand.safeParse(input);
    if (!command.success) return { status: 400, error: "Enter a street address or choose a suggestion." };
    const data = command.data;
    const status = await reserve(data.token);
    if (status !== 200) return { status, error: "Street lookup is unavailable. Enter the address manually." };
    const headers = { "X-Goog-Api-Key": key };
    const init = { redirect: "manual", signal: AbortSignal.timeout(5000) } as const;
    try {
      if (data.type === "search") {
        const response = await fetch(endpoint + "/places:autocomplete", {
          ...init, method: "POST",
          headers: { ...headers, "Content-Type": "application/json", "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text" },
          body: JSON.stringify({ input: [data.query, data.zip].filter(Boolean).join(" "), sessionToken: data.session, includedRegionCodes: ["us"], includedPrimaryTypes: ["street_address", "premise", "subpremise"], languageCode: "en" }),
        });
        if (!response.ok) throw new Error();
        const { suggestions } = predictions.parse(await response.json());
        return { value: suggestions.slice(0, 5).map(({ placePrediction: { placeId: id, text } }) => ({ id, label: text.text })) };
      }
      const url = new URL(endpoint + "/places/" + data.id);
      url.searchParams.set("sessionToken", data.session);
      const response = await fetch(url, { ...init, headers: { ...headers, "X-Goog-FieldMask": "addressComponents" } });
      if (!response.ok) throw new Error();
      const { addressComponents } = components.parse(await response.json());
      const component = (type: string, short = false) => {
        const part = addressComponents.find(({ types }) => types.includes(type));
        return (short ? part?.shortText : part?.longText) ?? "";
      };
      const street = [component("street_number"), component("route")].filter(Boolean).join(" ");
      const postal = component("postal_code");
      const suffix = component("postal_code_suffix");
      const location = { unit: component("subpremise"), city: component("locality") || component("postal_town") || component("sublocality_level_1"),
        state: component("administrative_area_level_1", true), zip: [postal, suffix].filter(Boolean).join("-") };
      if (!component("street_number") || !component("route") || component("country", true) !== "US") {
        return { status: 404, error: "Enter the street address manually." };
      }
      return { value: { street, location } };
    } catch {
      return { status: 502, error: "Street lookup is unavailable. Enter the address manually." };
    }
  }, 2048);
}
