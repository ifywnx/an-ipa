# Phase 3 — signed IPA metadata inspection

The owner signs applications using **LCSign on their iPhone**. AN IPA STORE does not sign or re-sign code and never asks for P12/private keys.

## Implemented (offline, not an upload endpoint)

`workers/ipa_inspector.py` examines **an already quarantined, untrusted IPA** without extraction. It limits archive size (500 MiB), entries (20,000), inflated size (2 GiB), suspicious compression ratio, filenames/traversal, symlinks and duplicate/case-insensitive paths. It extracts the single top-level `Payload/*.app` `Info.plist` in XML/binary format, `CFBundleIdentifier`, version and executable checks, and `embedded.mobileprovision` metadata. It rejects mismatched application identifiers, expired profiles and development `get-task-allow=true`. The tool deliberately does not list real UDIDs in output: only a count.

The embedded mobileprovision is a CMS container; inspection currently invokes OpenSSL `cms -verify -noverify` to check the **cryptographic content integrity only**. Since `-noverify` disables certificate-chain verification, metadata is **untrusted** even after successful parsing. The report always returns `apple_signer_chain_trusted=false`, `install_eligible=false`, and `quarantined_not_verified`.

Independent verification of Apple profile chain, actual app binary and nested framework signatures, entitlements and trust is **NOT implemented** and cannot be asserted based on the inspection report. The signing check may require a hardened macOS worker using `codesign --verify` for validation only; the owner does not need to sign on a Mac.

## Nested-code (dylib) inventory — embedded metadata checks

**Every IPA published on this store is a dylib-injected (tweaked) build** (owner-confirmed). The inspector therefore also inventories nested code and treats the following as mandatory pre-release checks:

1. **Inventory.** Every nested Mach-O component — main executable, each `.dylib`, each `.framework` binary, each `.appex` (and nested `.app`) binary — is listed with its bundle path, whether an embedded code signature is present, and the Team ID *declared* in its CodeDirectory blob. The sanitized worker report persists a bounded form of this list (`nested_components`, capped so the stored report stays within the 4096-byte `scan_report` limit) and the Admin intake view shows it for review.
2. **Nested signature consistency.** Every component must carry an embedded signature and all declared Team IDs must match. Findings are recorded as `NESTED_SIGNATURE_MISSING`, `NESTED_SIGNATURE_UNREADABLE` or `NESTED_TEAM_MISMATCH`, and the OTA policy denies with the same codes (`NESTED_SIGNATURE_MISSING`, `NESTED_TEAM_MISMATCH`) until a trusted verifier confirms them.
3. **Dylib dependency resolution.** Load commands of the main executable and of injected dylibs are resolved against the bundle: references to jailbreak substrate locations (e.g. `/Library/MobileSubstrate/...`, CydiaSubstrate), other non-system absolute paths, or `@rpath`/`@executable_path`/`@loader_path` targets that are not shipped in the bundle are flagged as `DYLIB_UNRESOLVED_DEPENDENCY`, because the app would crash on a non-jailbroken device. Apple system locations (`/System/Library/...`, `/usr/lib/...`) are accepted as system-provided.

Hard limits of this layer, deliberately unchanged: the parser reads the signature *declaration* (superblob/CodeDirectory presence and the Team ID string). It does **not** validate CodeDirectory hashes, the CMS signature over the signature blob, certificate chains or revocation. A component reported as "signed, Team X" has only claimed so. The trusted Apple verification blocker below therefore remains fully in force, and inspection output still always returns `apple_signer_chain_trusted=false`, `code_signature_verified=false` and `install_eligible=false`.

## CLI
```bash
python3 -I workers/ipa_inspector.py /private/quarantine/app.ipa
python3 -m unittest discover -s workers/tests -v
```

No private IPA is committed. CI builds **synthetic** CMS certificates and IPA fixtures locally and removes them automatically.

## Next mandatory steps

1. Authenticated Admin, upload size quotas and resumable private object-store intake from iPhone.
2. Isolated unprivileged worker execution with no network, CPU/memory/time limits and malware scanning.
3. Real Apple chain trust, codesign verification including nested binaries, embedded profile/device entitlements, and immutable content-hash attestation. (The embedded-metadata inventory above narrows what the macOS verifier must confirm; it does not discharge this step.)
4. Persistent multiversion registry and Admin UI showing blocked versus verified status.
5. RLS/IDOR/CSRF checks, malicious archive fuzzing, test IPA authorized by developer, and physical iPhone OTA validation.

## Current CI

GitHub CI runs `python3 -m unittest discover -s workers/tests -v` before Node unit tests, TypeScript and Next.js build. This checks synthetic CMS and unsafe ZIP structures only; neither simulated tests nor the inspector can replace validating real LCSign-signed IPA on authorized devices.
