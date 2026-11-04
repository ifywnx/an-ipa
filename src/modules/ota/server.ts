import "server-only";
import { otaReleaseGateFromEnv, type OtaReleaseGate } from "../distribution/policy";
import { enrollmentDb } from "../enrollment/server";
import { decryptUdid, keyFromBase64 } from "../enrollment/secure";
import { validateR2, type PrivateR2 } from "../ipa/r2-presign";
import { presignPrivateObjectGet } from "./delivery";
import { SupabaseOtaEvidenceAdapter, type OtaDbClient } from "./evidence";
import type {
  InstallGrantRecord,
  InstallGrantRepository,
} from "./grants";
import type { OtaFlowDeps } from "./flow";

/**
 * Server composition for the public OTA endpoints. Everything here runs
 * with the Supabase service role; no evidence field is accepted from a
 * client. Routes stay thin wrappers around these functions so the whole
 * flow is unit-testable with fakes.
 */

export interface OtaServerConfig {
  supabaseUrl: string;
  serviceKey: string;
  appOrigin: string;
  deliveryHosts: string[];
  releaseGate: OtaReleaseGate;
  r2: PrivateR2 | null;
  udidEncryptionKey: Buffer | null;
}

export function getOtaServerConfig(
  env: NodeJS.ProcessEnv = process.env,
): OtaServerConfig | null {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY || !env.APP_ORIGIN) return null;
  try {
    const db = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
    const origin = new URL(env.APP_ORIGIN);
    if (db.protocol !== "https:" || db.origin !== env.NEXT_PUBLIC_SUPABASE_URL
      || db.username || db.password) return null;
    if (origin.protocol !== "https:" || origin.origin !== env.APP_ORIGIN
      || origin.username || origin.password) return null;
    const r2Candidate: PrivateR2 = {
      accountId: env.R2_ACCOUNT_ID ?? "",
      bucket: env.R2_BUCKET ?? "",
      accessKeyId: env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "",
    };
    let udidEncryptionKey: Buffer | null = null;
    if (env.ENROLLMENT_UDID_ENCRYPTION_KEY_B64) {
      try {
        udidEncryptionKey = keyFromBase64(env.ENROLLMENT_UDID_ENCRYPTION_KEY_B64);
      } catch {
        udidEncryptionKey = null;
      }
    }
    return {
      supabaseUrl: db.origin,
      serviceKey: env.SUPABASE_SECRET_KEY,
      appOrigin: origin.origin,
      deliveryHosts: [origin.hostname],
      releaseGate: otaReleaseGateFromEnv({
        OTA_INSTALL_ENABLED: env.OTA_INSTALL_ENABLED,
        OTA_INSTALL_PIPELINE_READY: env.OTA_INSTALL_PIPELINE_READY,
      }),
      r2: validateR2(r2Candidate) ? r2Candidate : null,
      udidEncryptionKey,
    };
  } catch {
    return null;
  }
}

export function createRestOtaDbClient(cfg: OtaServerConfig): OtaDbClient {
  return {
    async select(path: string): Promise<unknown[]> {
      const rows = await enrollmentDb<unknown>({ supabaseUrl: cfg.supabaseUrl, serviceKey: cfg.serviceKey }, path);
      return Array.isArray(rows) ? rows : [];
    },
  };
}

interface InstallGrantRow {
  id: string;
  token_hash: string;
  device_id: string;
  version_id: string;
  channel_id: string | null;
  artifact_sha256: string;
  status: "active" | "revoked";
  issued_at: string;
  expires_at: string;
  first_used_at: string | null;
  last_used_at: string | null;
  use_count: number;
  revoked_at: string | null;
  created_by: string | null;
}

function rowToGrant(row: InstallGrantRow): InstallGrantRecord {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    deviceId: row.device_id,
    versionId: row.version_id,
    channelId: row.channel_id,
    artifactSha256: row.artifact_sha256,
    status: row.status,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    firstUsedAt: row.first_used_at,
    lastUsedAt: row.last_used_at,
    useCount: row.use_count,
    revokedAt: row.revoked_at,
    createdBy: row.created_by,
  };
}

const GRANT_COLUMNS =
  "id,token_hash,device_id,version_id,channel_id,artifact_sha256,status,issued_at,expires_at,first_used_at,last_used_at,use_count,revoked_at,created_by";

/** Repository backed by the install_grants table (service role only). */
export class SupabaseInstallGrantRepository implements InstallGrantRepository {
  constructor(private readonly cfg: OtaServerConfig) {}

  private db<T>(path: string, init: RequestInit = {}): Promise<T> {
    return enrollmentDb<T>(
      { supabaseUrl: this.cfg.supabaseUrl, serviceKey: this.cfg.serviceKey },
      path,
      init,
    );
  }

  async insert(record: InstallGrantRecord): Promise<void> {
    await this.db("install_grants", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        id: record.id,
        token_hash: record.tokenHash,
        device_id: record.deviceId,
        version_id: record.versionId,
        channel_id: record.channelId,
        artifact_sha256: record.artifactSha256,
        status: record.status,
        issued_at: record.issuedAt,
        expires_at: record.expiresAt,
        created_by: record.createdBy,
      }),
    });
  }

  async findByTokenHash(tokenHash: string): Promise<InstallGrantRecord | null> {
    const rows = await this.db<InstallGrantRow[]>(
      `install_grants?select=${GRANT_COLUMNS}&token_hash=eq.${tokenHash}&limit=1`,
    );
    return rows[0] ? rowToGrant(rows[0]) : null;
  }

  async markUsed(id: string, at: Date): Promise<void> {
    const rows = await this.db<InstallGrantRow[]>(
      `install_grants?select=${GRANT_COLUMNS}&id=eq.${id}&limit=1`,
    );
    const current = rows[0];
    if (!current) throw new Error("INSTALL_GRANT_NOT_FOUND");
    await this.db(`install_grants?id=eq.${id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        first_used_at: current.first_used_at ?? at.toISOString(),
        last_used_at: at.toISOString(),
        use_count: current.use_count + 1,
      }),
    });
  }

  async revoke(id: string, at: Date): Promise<boolean> {
    const rows = await this.db<InstallGrantRow[]>(
      `install_grants?select=id,status&id=eq.${id}&limit=1`,
    );
    if (!rows[0] || rows[0].status === "revoked") return false;
    await this.db(`install_grants?id=eq.${id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "revoked", revoked_at: at.toISOString() }),
    });
    return true;
  }
}

export function createOtaFlowDeps(cfg: OtaServerConfig): OtaFlowDeps {
  const adapter = new SupabaseOtaEvidenceAdapter(createRestOtaDbClient(cfg), {
    releaseGate: cfg.releaseGate,
    decryptUdid: cfg.udidEncryptionKey
      ? (ciphertext: string) => decryptUdid(cfg.udidEncryptionKey as Buffer, ciphertext)
      : undefined,
  });
  return {
    grants: new SupabaseInstallGrantRepository(cfg),
    adapter,
    appOrigin: cfg.appOrigin,
    deliveryHosts: cfg.deliveryHosts,
    presignGet: (objectKey, ttlSeconds, now) =>
      cfg.r2 ? presignPrivateObjectGet(cfg.r2, objectKey, ttlSeconds, now) : null,
  };
}


export {
  issueInstallGrant,
  loadGrantAccess,
  serveOtaManifest,
  serveOtaDownload,
} from "./flow";
export type {
  IssueGrantResult,
  GrantAccessResult,
  ServeManifestResult,
  ServeDownloadResult,
} from "./flow";
