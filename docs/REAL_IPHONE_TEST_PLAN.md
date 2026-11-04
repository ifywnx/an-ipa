# AN IPA STORE — physical iPhone acceptance test (NOT YET PERFORMED)

**Status:** Tests in GitHub Actions are unit/build/static checks only. No physical iPhone or production-ready Profile Service provider has been available to this implementation. No real UDID was collected, no profile was installed, and no OTA installation was verified.

## Preconditions
- Authorized test iPhone in owner's possession, current iOS version recorded, Safari version recorded.
- HTTPS deployment/staging domain with correctly scoped cookies, no caching of profile/status/UDID, TLS trust.
- Real Profile Service implementation supporting Apple's device-signed CMS response and, where required, SCEP/certificate enrollment. Trust anchor and device signer chain independently reviewed; ensure chain validation is modern and not based on bypassing X.509 checks.
- Attestation signing service external to web app with Ed25519 private key; only public key installed in web env.
- Per-request challenge, atomic consume and expiry.
- Ingress WAF/anti-bot, sanitized source-IP header and rate limit tested. Enable flags only after validation.
- Privacy notice, consent, data retention/deletion, admin RBAC review.

## Manual iPhone scenarios
| ID | Action | Expected | Result |
|---|---|---|---|
| S1 | Open `/udid` in Safari, no consent | Download blocked | Not run |
| S2 | Consent; create session | Unique token + HTTPS real Profile Service link | Not run |
| S3 | Tap profile download | iOS native profile prompt (no fabricated alert) | Not run |
| S4 | Install in Settings > Profile Downloaded | Real profile workflow progresses | Not run |
| S5 | Provider verifies device CMS response | Trusted issuer/chain+challenge; exact UDID | Not run |
| S6 | Return to Safari | Status shows true UDID, copy works | Not run |
| S7 | Replay callback or wrong challenge | Rejected; no duplicate confirmation | Not run |
| S8 | Forged signature / untrusted CA | Rejected; no UDID accepted | Not run |
| S9 | Expire after 8 minutes | No UDID returned; new session required | Not run |
| S10 | Open result from different browser | UDID must not leak | Not run |
| S11 | Rate-limit repeated new sessions | Blocked by DB+WAF | Not run |
| S12 | Manual UDID not verified by Apple | Not eligible for OTA | Not run |
| S13 | Signed Ad Hoc IPA without this UDID | No install link | Not run |
| S14 | Re-sign in LCSign with updated profile | New build scanned & verified separately | Not run |
| S15 | OTA install on eligible test phone | iOS installs approved signed app over HTTPS | Not run |

**Important:** Apple's older Profile Service guide is archived. If current iOS no longer supports a stage of the flow, do not substitute a spoofed profile; use a supported enrollment/MDM solution and re-review privacy and Apple policies.

References: https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/iPhoneOTAConfiguration/OTASecurity/OTASecurity.html and https://support.apple.com/en-us/102400
