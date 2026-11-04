# Signed IPA ingestion boundary

Owner signs IPA with **LCSign on their iPhone**. This service never signs anything, never asks for P12/private keys, and must not store those credentials.

The mobile Admin page performs only local filename, size and ZIP-header preflight. It **does not upload** until server-verified Admin authentication, private object store and a resumable quarantine intake are configured. Never pretend upload success.

A worker must perform archive safety and Info.plist/embedded.mobileprovision metadata extraction. **Metadata is not signature verification.** A separate trusted verification backend checks app code signing, profile signature/expiry, Team ID, bundle ID and entitlements. If any step is unavailable, set status to blocked/pending. Unverified archives never reach public OTA.

See ARCHITECTURE.md, IMPLEMENTATION_PLAN.md and docs/LCSIGN_IPHONE_WORKFLOW.md.
