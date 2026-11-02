# Apple Profile Service — verified CMS proof-of-concept

## Implemented
`src/modules/enrollment/apple-cms.ts` is a server/worker-only verifier for phase-2 Profile Service responses. It calls OpenSSL CMS in a bounded, temporary directory with a **configured pinned trusted device certificate authority**. It does **not** use `-noverify`, `-nosigs` or `-no_content_verify`. The verified payload must be a strict flat plist containing one UDID and the exact current challenge. It rejects mismatches, malformed/duplicate entries and untrusted certificate chains.

`tests/apple-cms.test.ts` creates a **synthetic** CA, simulated device certificate, CMS signed data and tampered response for local CI. These are disposable test credentials, **not Apple identities**. No key is committed. Tests validate the OpenSSL cryptographic integration but **do not prove genuine Apple device attestation**.

## Not complete — blocking prerequisites

1. Obtain a legitimate modern Apple device-identity trust chain and confirm correct validation (including chain extensions, certificate policy, expiration and appropriate revocation handling). The legacy Apple iPhone Device CA certificate in archived docs is **not** a modern trust assertion. Do not simply ignore certificate expiry because old sample code said so.
2. Deploy a real, hardened Profile Service endpoint with native Apple-signed CMS ingestion and proper HTTPS. The verifier is a pure worker helper; there is **no public CMS endpoint yet**, and there is no issued mobileconfig. Separate the trusted device CA from the service's own signing CA.
3. Supply legitimate SCEP enrollment CA / signed and encrypted follow-on profiles or an equivalently supported modern device enrollment implementation. Phase 2 CMS is not Phase 3 completion.
4. Only after all phases and real-iPhone tests should a trusted provider issue the signed assertion already supported by `/api/enrollment/verified-callback` to mark the guest request verified. Provider secret signer is **not** an IPA/P12 signing certificate and must be held in a secret manager or HSM.
5. Ensure request body limits, anti-replay, abuse protection, privacy retention/deletion, certificate auditing and independent review before public launch. Public production feature flags stay disabled.

## Constraints

The store owner signs IPA solely via LCSign on iPhone. This verifier verifies device-originated **CMS only**, never signs IPA, never requests the user's LCSign P12/private key, and never exposes UDID in logs. It is intentionally not connected to the public enrollment callback until an Apple-compliant service is available.
