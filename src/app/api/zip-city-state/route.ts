import cities from "@/data/us-zip-cities.json";

const localities: Record<string, readonly string[] | undefined> = cities;

export function GET(request: Request) {
  const zip = new URL(request.url).searchParams.get("zip") ?? "";
  if (!/^\d{5}$/.test(zip)) return Response.json({ error: "Enter a five-digit ZIP code." }, { status: 400 });
  const match = localities[zip];
  if (!match) return Response.json({ error: "ZIP code not found." }, { status: 404 });
  const [city, state] = match;
  return Response.json({ city, state }, { headers: { "Cache-Control": "public, max-age=86400" } });
}
