import { otaDenials, type OtaEvidence } from "../distribution/policy";
/**
 * Pure OTA rendering only, NOT an install endpoint. The caller must obtain
 * these server-verified facts from trusted persistent state and sign/recheck grants.
 */
export interface VerifiedOtaGrant {
  evidence: OtaEvidence;
  appPublished: boolean;
  versionPublished: boolean;
  artifactVerified: boolean;
  distributionRightsReviewed: boolean;
  artifactSha256: string;
  bundleIdentifier: string;
  version: string;
  title: string;
  ipaUrl: string;
  manifestUrl: string;
  grantExpiresAt: string;
}
export class OtaDenied extends Error {
  constructor(public readonly reasons: string[]) {super("OTA denied: "+reasons.join(", "));}
}
const escapeXml=(s:string):string=>s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&apos;");
function approvedHttpsUrl(value:string,hosts:readonly string[]):boolean {
  try {
    const u=new URL(value);
    return u.protocol==="https:" && !u.username && !u.password && !u.hash && !u.port && hosts.includes(u.hostname);
  } catch {return false;}
}
export function denyOtaGrant(g:VerifiedOtaGrant,hosts:readonly string[],now=new Date()):string[] {
  const problems=otaDenials(g.evidence,now);
  if(!g.appPublished||!g.versionPublished) problems.push("NOT_PUBLISHED");
  if(!g.artifactVerified) problems.push("CRYPTO_VERIFICATION_REQUIRED");
  if(!g.distributionRightsReviewed) problems.push("DISTRIBUTION_RIGHTS_REQUIRED");
  if(!/^[a-f0-9]{64}$/.test(g.artifactSha256)) problems.push("UNTRUSTED_IPA_HASH");
  if(!/^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)+$/.test(g.bundleIdentifier) ||
    g.bundleIdentifier!==g.evidence.bundleId) problems.push("BUNDLE_ID_MISMATCH");
  if(!/^[0-9]+(?:\.[0-9]+){0,3}$/.test(g.version) || g.version.length>40) problems.push("INVALID_VERSION");
  if(!g.title || g.title.length>100 || /[\x00-\x1F\x7f]/.test(g.title)) problems.push("INVALID_TITLE");
  if(!hosts.length || !approvedHttpsUrl(g.ipaUrl,hosts) || !approvedHttpsUrl(g.manifestUrl,hosts))
    problems.push("UNAPPROVED_DELIVERY_HOST");
  const expiry=Date.parse(g.grantExpiresAt);
  if(!Number.isFinite(expiry) || expiry<=now.getTime() || expiry>now.getTime()+600_000)
    problems.push("GRANT_EXPIRED_OR_TOO_LONG");
  return problems;
}
export function buildOtaManifest(g:VerifiedOtaGrant,hosts:readonly string[],now=new Date()):string {
  const problems=denyOtaGrant(g,hosts,now);
  if(problems.length) throw new OtaDenied(problems);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>items</key><array><dict>
<key>assets</key><array><dict><key>kind</key><string>software-package</string><key>url</key><string>${escapeXml(g.ipaUrl)}</string></dict></array>
<key>metadata</key><dict><key>bundle-identifier</key><string>${escapeXml(g.bundleIdentifier)}</string><key>bundle-version</key><string>${escapeXml(g.version)}</string><key>kind</key><string>software</string><key>title</key><string>${escapeXml(g.title)}</string></dict>
</dict></array></dict></plist>`;
}
export function buildItmsServicesUrl(g:VerifiedOtaGrant,hosts:readonly string[],now=new Date()):string {
  const problems=denyOtaGrant(g,hosts,now);
  if(problems.length) throw new OtaDenied(problems);
  return "itms-services://?action=download-manifest&url="+encodeURIComponent(g.manifestUrl);
}
