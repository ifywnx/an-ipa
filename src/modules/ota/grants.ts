import { randomUUID } from "node:crypto";
import { randomToken, sha256 } from "../enrollment/secure";

/**
 * Persistent OTA install grants (domain layer).
 *
 * A grant binds exactly one trusted device record, one app version and one
 * verifier-recorded artifact hash. The bearer token is returned to the
 * issuer exactly once; only its SHA-256 hash is ever stored.
 *
 * Window semantics (deliberate, not single-use): iOS fetches the manifest,
 * then the IPA, and may retry either fetch. A grant therefore stays usable
 * for manifest + download until it expires or is revoked. The TTL is capped
 * at 10 minutes because `denyOtaGrant` rejects any grant whose expiry is
 * further out than that. First use is recorded (`firstUsedAt`) but does not
 * consume the grant.
 */
export const INSTALL_GRANT_TTL_MS = 600_000;
export const INSTALL_GRANT_MIN_TTL_MS = 30_000;
export const INSTALL_GRANT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;

export type InstallGrantStoredStatus = "active" | "revoked";
export type InstallGrantEffectiveStatus = "active" | "revoked" | "expired";

export interface InstallGrantRecord {
  id: string;
  tokenHash: string;
  deviceId: string;
  versionId: string;
  channelId: string | null;
  artifactSha256: string;
  status: InstallGrantStoredStatus;
  issuedAt: string;
  expiresAt: string;
  firstUsedAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
  revokedAt: string | null;
  createdBy: string | null;
}

export function installGrantStatusAt(
  record: Pick<InstallGrantRecord, "status" | "expiresAt">,
  now: Date = new Date(),
): InstallGrantEffectiveStatus {
  if (record.status === "revoked") return "revoked";
  if (!Number.isFinite(Date.parse(record.expiresAt)) || Date.parse(record.expiresAt) <= now.getTime()) {
    return "expired";
  }
  return "active";
}

/** Denials that depend only on the stored grant record (not on evidence). */
export function installGrantRecordDenials(
  record: InstallGrantRecord | null,
  now: Date = new Date(),
): string[] {
  if (!record) return ["GRANT_NOT_FOUND"];
  const status = installGrantStatusAt(record, now);
  if (status === "revoked") return ["GRANT_REVOKED"];
  if (status === "expired") return ["GRANT_EXPIRED"];
  return [];
}

export interface InstallGrantRepository {
  insert(record: InstallGrantRecord): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<InstallGrantRecord | null>;
  /** Records a manifest/download use inside the validity window. */
  markUsed(id: string, at: Date): Promise<void>;
  revoke(id: string, at: Date): Promise<boolean>;
}

/** In-memory repository for tests and local development only. */
export class InMemoryInstallGrantRepository implements InstallGrantRepository {
  private readonly byId = new Map<string, InstallGrantRecord>();
  private readonly idByHash = new Map<string, string>();

  async insert(record: InstallGrantRecord): Promise<void> {
    if (this.byId.has(record.id) || this.idByHash.has(record.tokenHash)) {
      throw new Error("INSTALL_GRANT_DUPLICATE");
    }
    this.byId.set(record.id, { ...record });
    this.idByHash.set(record.tokenHash, record.id);
  }

  async findByTokenHash(tokenHash: string): Promise<InstallGrantRecord | null> {
    const id = this.idByHash.get(tokenHash);
    const record = id ? this.byId.get(id) : undefined;
    return record ? { ...record } : null;
  }

  async markUsed(id: string, at: Date): Promise<void> {
    const record = this.byId.get(id);
    if (!record) throw new Error("INSTALL_GRANT_NOT_FOUND");
    record.firstUsedAt ??= at.toISOString();
    record.lastUsedAt = at.toISOString();
    record.useCount += 1;
  }

  async revoke(id: string, at: Date): Promise<boolean> {
    const record = this.byId.get(id);
    if (!record || record.status === "revoked") return false;
    record.status = "revoked";
    record.revokedAt = at.toISOString();
    return true;
  }
}

export interface BuildInstallGrantInput {
  deviceId: string;
  versionId: string;
  channelId?: string | null;
  artifactSha256: string;
  createdBy?: string | null;
  ttlMs?: number;
  now?: Date;
  /** Injectable for tests; production callers must omit both. */
  token?: string;
  id?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function buildInstallGrantRecord(
  input: BuildInstallGrantInput,
): { record: InstallGrantRecord; token: string } {
  if (!isUuid(input.deviceId)) throw new Error("INSTALL_GRANT_DEVICE_ID_INVALID");
  if (!isUuid(input.versionId)) throw new Error("INSTALL_GRANT_VERSION_ID_INVALID");
  if (input.channelId != null && !isUuid(input.channelId)) {
    throw new Error("INSTALL_GRANT_CHANNEL_ID_INVALID");
  }
  if (!/^[a-f0-9]{64}$/.test(input.artifactSha256)) {
    throw new Error("INSTALL_GRANT_ARTIFACT_HASH_INVALID");
  }
  const ttlMs = input.ttlMs ?? INSTALL_GRANT_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < INSTALL_GRANT_MIN_TTL_MS || ttlMs > INSTALL_GRANT_TTL_MS) {
    throw new Error("INSTALL_GRANT_TTL_OUT_OF_RANGE");
  }
  const token = input.token ?? randomToken();
  if (!INSTALL_GRANT_TOKEN_PATTERN.test(token)) throw new Error("INSTALL_GRANT_TOKEN_INVALID");
  const issuedAt = input.now ?? new Date();
  if (!Number.isFinite(issuedAt.getTime())) throw new Error("INSTALL_GRANT_TIME_INVALID");
  const record: InstallGrantRecord = {
    id: input.id ?? randomUUID(),
    tokenHash: sha256(token),
    deviceId: input.deviceId,
    versionId: input.versionId,
    channelId: input.channelId ?? null,
    artifactSha256: input.artifactSha256,
    status: "active",
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + ttlMs).toISOString(),
    firstUsedAt: null,
    lastUsedAt: null,
    useCount: 0,
    revokedAt: null,
    createdBy: input.createdBy ?? null,
  };
  return { record, token };
}
