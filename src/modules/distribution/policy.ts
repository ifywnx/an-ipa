// Use only with server-verified records. Never accept this evidence from a client.
export interface OtaEvidence {
 deviceStatus: string; appleRegistered: boolean; deviceUdid: string;
 profileUdids: readonly string[]; profileExpiresAt: string;
 signatureVerified: boolean; entitlementsMatch: boolean;
 bundleId: string; profileBundleId: string; distributionAuthorized: boolean;
}
export function otaDenials(e: OtaEvidence, now = new Date()): string[] {
 const reasons: string[] = [];
 if(e.deviceStatus !== "approved") reasons.push("DEVICE_NOT_APPROVED");
 if(!e.appleRegistered) reasons.push("APPLE_REGISTRATION_REQUIRED");
 if(!e.deviceUdid || !e.profileUdids.includes(e.deviceUdid)) reasons.push("DEVICE_NOT_IN_PROFILE");
 if(!Number.isFinite(Date.parse(e.profileExpiresAt)) || Date.parse(e.profileExpiresAt) <= now.getTime()) reasons.push("PROFILE_EXPIRED_OR_INVALID");
 if(!e.signatureVerified) reasons.push("SIGNATURE_NOT_VERIFIED");
 if(!e.entitlementsMatch) reasons.push("ENTITLEMENTS_MISMATCH");
 if(!e.bundleId || e.bundleId !== e.profileBundleId) reasons.push("BUNDLE_MISMATCH");
 if(!e.distributionAuthorized) reasons.push("DISTRIBUTION_NOT_AUTHORIZED");
 return reasons;
}
