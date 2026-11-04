export type DeviceStatus = "pending" | "approved" | "rejected" | "revoked";
export function normalizeUdid(value: string): string {
 const udid = value.trim().toUpperCase();
 if (!/^(?:[0-9A-F]{40}|[0-9A-F]{8}-[0-9A-F]{16})$/.test(udid)) throw new Error("Invalid UDID format");
 return udid; // Format validation is NOT identity verification.
}
export function canTransition(role: string, from: DeviceStatus, to: DeviceStatus): boolean {
 if(role !== "admin") return false;
 return ({pending:["approved","rejected","revoked"],approved:["revoked"],rejected:[],revoked:[]} as Record<DeviceStatus,DeviceStatus[]>)[from].includes(to);
}
