import "server-only";
import {enrollmentDb} from "../enrollment/server";
import type {AccountDbClient} from "./ownership";
import type {CustomerAccountsConfig} from "../auth/customer-server";

/**
 * Service-role REST client for account ownership data. Every query made
 * through it is scoped by a user id that came from a server-verified
 * Supabase session — never from client input (see ownership.ts).
 */
export function createAccountDbClient(cfg: CustomerAccountsConfig): AccountDbClient {
  const base = {supabaseUrl: cfg.supabaseUrl, serviceKey: cfg.serviceKey};
  return {
    async select(path: string): Promise<unknown[]> {
      const rows = await enrollmentDb<unknown>(base, path);
      return Array.isArray(rows) ? rows : [];
    },
    async rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
      return await enrollmentDb<T>(base, "rpc/" + name, {
        method: "POST", body: JSON.stringify(body),
      });
    },
  };
}

/** Resolve an account email for Admin display via the Supabase Auth admin
 *  API (service role). Returns null on any failure so the Admin page can
 *  fall back to a neutral label instead of breaking. Never logged. */
export async function lookupAccountEmail(
  cfg: CustomerAccountsConfig, userId: string,
  transport: typeof fetch = fetch,
): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  try {
    const response = await transport(
      `${cfg.supabaseUrl}/auth/v1/admin/users/${userId}`, {
        method: "GET",
        headers: {apikey: cfg.serviceKey, Authorization: "Bearer " + cfg.serviceKey},
        signal: AbortSignal.timeout(5000), cache: "no-store",
      });
    if (!response.ok) return null;
    const json: unknown = await response.json();
    if (!json || typeof json !== "object") return null;
    const email = (json as {email?: unknown}).email;
    return typeof email === "string" && email ? email : null;
  } catch { return null; }
}
