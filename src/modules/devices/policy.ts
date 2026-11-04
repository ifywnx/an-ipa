export type DeviceStatus = "pending" | "approved" | "rejected" | "revoked";

export type UdidFormat = "legacy_40_hex" | "modern_dashed";

export interface UdidValidation {
  valid: boolean;
  normalized: string | null;
  format: UdidFormat | null;
  reason: string | null;
}

const LEGACY_UDID = /^[0-9A-F]{40}$/;
const MODERN_UDID = /^[0-9A-F]{8}-[0-9A-F]{16}$/;

function invalidUdid(reason: string): UdidValidation {
  return { valid: false, normalized: null, format: null, reason };
}

/**
 * Format-check and canonicalize the two UDID spellings accepted by the
 * existing enrollment/manual-intake code. Canonical form is uppercase and the
 * modern dash is significant: do not compare UDIDs by stripping punctuation.
 * This is syntax validation only, never proof of device possession/identity.
 */
export function validateUdid(value: unknown): UdidValidation {
  if (typeof value !== "string") return invalidUdid("UDID_MUST_BE_STRING");
  const trimmed = value.trim();
  if (!trimmed) return invalidUdid("UDID_EMPTY");
  if (/\s/.test(trimmed)) return invalidUdid("UDID_CONTAINS_WHITESPACE");

  const normalized = trimmed.toUpperCase();
  if (LEGACY_UDID.test(normalized)) {
    return { valid: true, normalized, format: "legacy_40_hex", reason: null };
  }
  if (MODERN_UDID.test(normalized)) {
    return { valid: true, normalized, format: "modern_dashed", reason: null };
  }
  if (trimmed.includes("-")) return invalidUdid("UDID_DASHED_FORMAT_INVALID");
  if (/^[0-9A-F]+$/i.test(trimmed)) return invalidUdid("UDID_HEX_LENGTH_INVALID");
  return invalidUdid("UDID_INVALID_CHARACTERS");
}

export function isValidUdid(value: unknown): boolean {
  return validateUdid(value).valid;
}

export function normalizeUdid(value: string): string {
  const result = validateUdid(value);
  if (!result.valid || !result.normalized) throw new Error("Invalid UDID format");
  return result.normalized; // Format validation is NOT identity verification.
}

export function canTransition(role: string, from: DeviceStatus, to: DeviceStatus): boolean {
  if (role !== "admin") return false;
  return ({ pending: ["approved", "rejected", "revoked"], approved: ["revoked"], rejected: [], revoked: [] } as Record<DeviceStatus, DeviceStatus[]>)[from].includes(to);
}
