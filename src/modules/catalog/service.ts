import type { CatalogResult, PublicApp } from "./types";

/** Only anonymous, published metadata is queried. No privileged credential is used. */
function config(): { origin: string; key: string } | null {
  const origin = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!origin || !key) return null;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return { origin: parsed.origin, key };
  } catch { return null; }
}
export const validSlug = (value: string): boolean =>
  /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value);

export function parsePublicApps(value: unknown): PublicApp[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: unknown) => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    const keys = ["slug", "title", "summary", "category", "developer_name"] as const;
    if (!keys.every(k => typeof r[k] === "string")) return [];
    const app = Object.fromEntries(keys.map(k => [k, r[k]])) as unknown as PublicApp;
    if (!validSlug(app.slug) || app.title.length > 140 || app.summary.length > 1000) return [];
    return [app];
  });
}

async function queryPublished(
  slug?: string, transport: typeof fetch = fetch
): Promise<CatalogResult<PublicApp[]>> {
  const settings = config();
  if (!settings) return { state: "unconfigured", data: [] };
  if (slug !== undefined && !validSlug(slug)) return { state: "available", data: [] };
  const endpoint = new URL("/rest/v1/apps", settings.origin);
  endpoint.searchParams.set("select", "slug,title,summary,category,developer_name");
  endpoint.searchParams.set("status", "eq.published");
  endpoint.searchParams.set("order", "created_at.desc");
  endpoint.searchParams.set("limit", slug ? "1" : "100");
  if (slug) endpoint.searchParams.set("slug", "eq." + slug);
  try {
    const response = await transport(endpoint.toString(), {
      headers: { apikey: settings.key, Authorization: "Bearer " + settings.key, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return { state: "unavailable", data: [] };
    const json: unknown = await response.json();
    if (!Array.isArray(json)) return { state: "unavailable", data: [] };
    return { state: "available", data: parsePublicApps(json) };
  } catch {
    return { state: "unavailable", data: [] };
  }
}
export async function listPublicApps(transport?: typeof fetch) {
  return queryPublished(undefined, transport);
}
export async function findPublicApp(slug: string, transport?: typeof fetch) {
  const result = await queryPublished(slug, transport);
  return { state: result.state, data: result.data[0] ?? null } as CatalogResult<PublicApp | null>;
}
export function filterPublicApps(apps: PublicApp[], search: string, category: string) {
  const term = search.trim().toLocaleLowerCase("vi").slice(0, 60);
  return apps.filter(a =>
    (!category || a.category === category) &&
    (!term || [a.title, a.summary, a.developer_name].some(v => v.toLocaleLowerCase("vi").includes(term)))
  );
}
