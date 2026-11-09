import { zipCityState } from "@/lib/zip-city-state";

export function GET(request: Request) {
  const zip = new URL(request.url).searchParams.get("zip") ?? "";
  if (!/^\d{5}$/.test(zip)) return Response.json({ error: "Enter a five-digit ZIP code." }, { status: 400 });
  const match = zipCityState(zip);
  if (!match) return Response.json({ error: "ZIP code not found." }, { status: 404 });
  return Response.json(match, { headers: { "Cache-Control": "public, max-age=86400" } });
}
