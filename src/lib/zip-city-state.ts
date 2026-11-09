import cities from "../data/us-zip-cities.json" with { type: "json" };

const localities: Record<string, readonly string[] | undefined> = cities;

export function zipCityState(zip: string) {
  if (!/^\d{5}(?:-\d{4})?$/.test(zip)) return undefined;
  const match = localities[zip.slice(0, 5)];
  if (!match) return undefined;
  const [city, state] = match;
  return { city, state };
}
