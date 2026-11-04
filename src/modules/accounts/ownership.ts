/**
 * Account ownership of UDID intake records.
 *
 * The customer-visible device record is a row of manual_udid_requests: both
 * intake paths land there (manual form with source='manual_form', device
 * self-report via profile with source='self_profile'), always in
 * 'pending_unverified' or a review status. guest_enrollments rows are
 * short-lived browser sessions that feed that queue; ownership is recorded
 * on the session too so the profile callback can pass it on.
 *
 * Ownership rules enforced here and in the SQL RPCs (migration
 * 20261105140000):
 * - user_id comes only from a server-verified Supabase session. Clients
 *   never submit a user_id, an email or a UDID to claim anything.
 * - Claiming requires possession of the original browser credential: the
 *   manual-intake cookie token or the enrollment browser token. This module
 *   only ever receives their SHA-256 hashes. There is deliberately no
 *   function that looks a record up by UDID.
 * - An account link never changes a record's status and never feeds OTA
 *   eligibility; it is bookkeeping about who submitted the request.
 *
 * The module is transport-pure (an injected client) so it is unit-testable
 * with fakes, following the ota/evidence-map.ts precedent.
 */

export interface AccountDbClient {
  select(path: string): Promise<unknown[]>;
  rpc<T>(name: string, body: Record<string, unknown>): Promise<T>;
}

export interface AccountDevice {
  id: string;
  status: string;
  udidSuffix: string;
  deviceLabel: string;
  source: string;
  createdAt: string;
  expiresAt: string;
}

export interface AdminQueueRow extends AccountDevice {
  userId: string | null;
}

export interface PendingDeletion {
  id: string;
  userId: string;
  createdAt: string;
}

const DEVICE_COLUMNS = "id,status,udid_suffix,device_label,source,created_at,expires_at";
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_FORMAT = /^[a-f0-9]{64}$/;

function isUuid(value: string): boolean { return UUID_FORMAT.test(value); }
function isHash(value: string): boolean { return HASH_FORMAT.test(value); }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function mapDevice(row: Record<string, unknown>): AccountDevice | null {
  const id = asString(row.id);
  if (!isUuid(id)) return null;
  return {
    id,
    status: asString(row.status),
    udidSuffix: asString(row.udid_suffix),
    deviceLabel: asString(row.device_label),
    source: asString(row.source),
    createdAt: asString(row.created_at),
    expiresAt: asString(row.expires_at),
  };
}

/** All intake records owned by this account, newest first. The query is
 *  scoped by the verified user id; no other account's rows can match. */
export async function listAccountDevices(
  client: AccountDbClient, userId: string,
): Promise<AccountDevice[]> {
  if (!isUuid(userId)) return [];
  const rows = await client.select(
    `manual_udid_requests?select=${DEVICE_COLUMNS}&user_id=eq.${userId}`
    + "&order=created_at.desc&limit=50");
  return rows.map(asRecord).filter((r): r is Record<string, unknown> => r !== null)
    .map(mapDevice).filter((d): d is AccountDevice => d !== null);
}

/** Attach a freshly created manual request to the signed-in submitter. */
export async function attachManualRequest(
  client: AccountDbClient, requestId: string, userId: string,
): Promise<boolean> {
  if (!isUuid(requestId) || !isUuid(userId)) return false;
  return await client.rpc<boolean>("attach_manual_udid_request_owner", {
    p_request_id: requestId, p_user_id: userId,
  }) === true;
}

/** Attach a just-created guest enrollment session to the signed-in user so
 *  the later device callback can inherit the same owner. */
export async function attachGuestEnrollment(
  client: AccountDbClient, browserTokenHash: string, userId: string,
): Promise<boolean> {
  if (!isHash(browserTokenHash) || !isUuid(userId)) return false;
  return await client.rpc<boolean>("attach_guest_enrollment_owner", {
    p_browser_hash: browserTokenHash, p_user_id: userId,
  }) === true;
}

/** Pass ownership from a completed enrollment session to the pending
 *  self-profile request it produced. The SQL reads the owner from the
 *  session row itself; no user id is supplied by callers here. */
export async function linkSelfProfileRequest(
  client: AccountDbClient, challengeHash: string,
): Promise<boolean> {
  if (!isHash(challengeHash)) return false;
  return await client.rpc<boolean>("link_self_profile_request_to_enrollment", {
    p_challenge_hash: challengeHash,
  }) === true;
}

export interface BrowserCredentials {
  /** SHA-256 of the an_manual_udid cookie token, if the browser has one. */
  manualTokenHash?: string;
  /** SHA-256 of the an_enrollment cookie token, if the browser has one. */
  enrollmentBrowserHash?: string;
}

export interface ClaimResult {
  manualRequests: number;
  enrollments: number;
  selfProfileRequests: number;
  total: number;
}

/**
 * Claim records this browser previously submitted while logged out. Only
 * hashes of the browser's own cookie tokens are used; records already owned
 * by anyone are never touched (the RPCs require user_id is null), and there
 * is no claim path keyed by UDID.
 */
export async function claimBrowserDevices(
  client: AccountDbClient, credentials: BrowserCredentials, userId: string,
): Promise<ClaimResult> {
  const result: ClaimResult = {manualRequests: 0, enrollments: 0, selfProfileRequests: 0, total: 0};
  if (!isUuid(userId)) return result;
  if (credentials.manualTokenHash && isHash(credentials.manualTokenHash)) {
    const n = await client.rpc<number>("claim_manual_udid_requests", {
      p_request_token_hash: credentials.manualTokenHash, p_user_id: userId,
    });
    result.manualRequests = typeof n === "number" && n > 0 ? Math.floor(n) : 0;
  }
  if (credentials.enrollmentBrowserHash && isHash(credentials.enrollmentBrowserHash)) {
    const linked = await client.rpc<boolean>("claim_guest_enrollment_owner", {
      p_browser_hash: credentials.enrollmentBrowserHash, p_user_id: userId,
    });
    result.enrollments = linked === true ? 1 : 0;
    const n = await client.rpc<number>("claim_self_profile_udid_requests", {
      p_browser_hash: credentials.enrollmentBrowserHash, p_user_id: userId,
    });
    result.selfProfileRequests = typeof n === "number" && n > 0 ? Math.floor(n) : 0;
  }
  result.total = result.manualRequests + result.selfProfileRequests;
  return result;
}

/** Record (or reuse) the customer's UDID-data deletion request. Processing
 *  itself is an operator action; this only raises the flag with the exact
 *  wording promised by the draft privacy policy. */
export async function requestUdidDataDeletion(
  client: AccountDbClient, userId: string,
): Promise<string | null> {
  if (!isUuid(userId)) return null;
  const id = await client.rpc<unknown>("request_udid_data_deletion", {p_user_id: userId});
  return typeof id === "string" && isUuid(id) ? id : null;
}

/** The open deletion request for this account, if any. */
export async function openDeletionRequest(
  client: AccountDbClient, userId: string,
): Promise<PendingDeletion | null> {
  if (!isUuid(userId)) return null;
  const rows = await client.select(
    `customer_deletion_requests?select=id,user_id,created_at&user_id=eq.${userId}`
    + "&status=eq.pending&order=created_at.desc&limit=1");
  const row = asRecord(rows[0]);
  if (!row) return null;
  const id = asString(row.id);
  return isUuid(id) ? {id, userId: asString(row.user_id), createdAt: asString(row.created_at)} : null;
}

/** Admin view of the pending UDID queue (newest first), owner id included
 *  so the page can resolve and display the account email when there is one.
 *  Only the UDID suffix is selected — never the ciphertext or full UDID. */
export async function listAdminUdidQueue(
  client: AccountDbClient, limit = 50,
): Promise<AdminQueueRow[]> {
  const bounded = Math.min(Math.max(Math.floor(limit) || 50, 1), 100);
  const rows = await client.select(
    `manual_udid_requests?select=${DEVICE_COLUMNS},user_id`
    + `&order=created_at.desc&limit=${bounded}`);
  return rows.map(asRecord).filter((r): r is Record<string, unknown> => r !== null)
    .map(row => {
      const device = mapDevice(row);
      if (!device) return null;
      const userId = asString(row.user_id);
      return {...device, userId: isUuid(userId) ? userId : null};
    })
    .filter((d): d is AdminQueueRow => d !== null);
}

/** Admin view of unprocessed UDID-data deletion requests. */
export async function listPendingDeletionRequests(
  client: AccountDbClient, limit = 50,
): Promise<PendingDeletion[]> {
  const bounded = Math.min(Math.max(Math.floor(limit) || 50, 1), 100);
  const rows = await client.select(
    `customer_deletion_requests?select=id,user_id,created_at&status=eq.pending`
    + `&order=created_at.asc&limit=${bounded}`);
  return rows.map(asRecord).filter((r): r is Record<string, unknown> => r !== null)
    .map(row => {
      const id = asString(row.id), userId = asString(row.user_id);
      return isUuid(id) && isUuid(userId)
        ? {id, userId, createdAt: asString(row.created_at)} : null;
    })
    .filter((d): d is PendingDeletion => d !== null);
}
