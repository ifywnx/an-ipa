# Phase 3 — signed IPA metadata inspection

The owner signs applications using **LCSign on their iPhone**. AN IPA STORE does not sign or re-sign code and never asks for P12/private keys.

## Implemented (offline, not an upload endpoint)

`workers/ipa_inspector.py` examines **an already quarantined, untrusted IPA** without extraction. It limits archive size (500 MiB), entries (20,000), inflated size (2 GiB), suspicious compression ratio, filenames/traversal, symlinks and duplicate/case-insensitive paths. It extracts the single top-level `Payload/*.app` `Info.plist` in XML/binary format, `CFBundleIdentifier`, version and executable checks, and `embedded.mobileprovision` metadata. It rejects mismatched application identifiers, expired profiles and development `get-task-allow=true`. The tool deliberately does not list real UDIDs in output: only a count.

The embedded mobileprovision is a CMS container; inspection currently invokes OpenSSL `cms -verify -noverify` to check the **cryptographic content integrity only**. Since `-noverify` disables certificate-chain verification, metadata is **untrusted** even after successful parsing. The report always returns `apple_signer_chain_trusted=false`, `install_eligible=false`, and `quarantined_not_verified`.

Independent verification of Apple profile chain, actual app binary and nested framework signatures, entitlements and trust is **NOT implemented** and cannot be asserted based on the inspection report. The signing check may require a hardened macOS worker using `codesign --verify` for validation only; the owner does not need to sign on a Mac.

## CLI
```bash
python3 -I workers/ipa_inspector.py /private/quarantine/app.ipa
python3 -m unittest discover -s workers/tests -v
```

No private IPA is committed. CI builds **synthetic** CMS certificates and IPA fixtures locally and removes them automatically.

## Next mandatory steps

1. Authenticated Admin, upload size quotas and resumable private object-store intake from iPhone.
2. Isolated unprivileged worker execution with no network, CPU/memory/time limits and malware scanning.
3. Real Apple chain trust, codesign verification including nested binaries, embedded profile/device entitlements, and immutable content-hash attestation.
4. Persistent multiversion registry and Admin UI showing blocked versus verified status.
5. RLS/IDOR/CSRF checks, malicious archive fuzzing, test IPA authorized by developer, and physical iPhone OTA validation.
