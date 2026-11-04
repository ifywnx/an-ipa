# LCSign trên iPhone → AN IPA STORE

## Admin instructions
1. Open LCSign on **your own iPhone**, select an app IPA you are authorized to redistribute and sign it with your locally held certificate plus appropriate provisioning profile.
2. Export only the signed `.ipa` to Files on the iPhone; do **not** upload `.p12`, private keys, certificate passwords or device enrollment material to AN IPA STORE.
3. Open AN IPA STORE Admin in Safari on iPhone. Pick the signed `.ipa`. The current UI is **preflight-only** until authenticated private upload, quota and worker verification are deployed.
4. On private ingestion, the server quarantines the archive. Metadata extraction is not cryptographic signature verification. The app remains unavailable until code signing, profile trust/expiry, entitlements, bundle ID, rights and device eligibility are confirmed.
5. When the list of Ad Hoc devices changes, register devices with Apple through appropriate account access, edit/regenerate your provisioning profile, obtain the new profile, import it into LCSign **on your iPhone**, sign the IPA again and upload a new immutable version/build. The old signed IPA is not retroactively changed.
6. Test the OTA link on an authorized iPhone: the server must issue a time-limited HTTPS manifest with an HTTPS IPA asset and respect profile membership/expiry. A download click is not proof of installation.

## Device options
- **Manual**: guest can submit a UDID once the protected consent flow is ready. Until independently verified, status is `unverified`, not `registered` or `installable`.
- **Profile service**: Apple documents a Profile Service payload, challenge and device-signed CMS response. It needs certificate/trust validation and anti-replay. This does not justify publishing a simple fake mobileconfig for automatic UDID. Disabled until verified on real iPhones.

## Security and platform limits
- No valid cryptographic signature = no install. Profile service cannot sign IPA or replace provisioning.
- A certificate valid for 1 year may be development, Ad Hoc or enterprise; exact signing policy and intended audience matter.
- Ad Hoc requires a registered device included in the embedded profile; Apple imposes device membership restrictions.
- A Guest does not install LCSign. Only the store owner uses LCSign.
- No secrets, real UDIDs, IPA files or mobileprovision files in source control.

Sources: Apple Developer Ad Hoc provisioning, editing profiles, profile-service enrollment, and TN3125 code signing.
