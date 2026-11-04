export type StoreRole = "user" | "publisher" | "admin";
export const isStoreRole = (value: unknown): value is StoreRole =>
  value === "user" || value === "publisher" || value === "admin";
/** Roles may only originate from a server-side authenticated database lookup. */
export function canManageApp(role: StoreRole, ownerId: string, actorId: string): boolean {
  return role === "admin" || (role === "publisher" && !!actorId && actorId === ownerId);
}
export function canManageDevice(role: StoreRole): boolean { return role === "admin"; }
export function canPublish(role: StoreRole): boolean { return role === "admin"; }
