# Vercel quarantine worker

Website, Admin and API remain on Vercel; Supabase stores queue/leases/results;
private Cloudflare R2 holds IPA objects. Railway is not required or deployed.

`processIpaReceipt` is a durable Vercel Workflow started after upload acknowledgement.
Each scan uses a temporary Vercel Sandbox, no public port, one vCPU, no snapshots,
210-second lifetime and egress restricted to the configured R2 account host.
The Python process has bounded memory, CPU, bytes, archive members and download time.
It reads every archive member to validate sizes and CRC without extracting executable code.
Only a 240-second presigned GET for the exact receipt object enters the sandbox.
Supabase/R2 account keys remain in the server runtime, never in the sandbox/job input.

## Configuration

Preview branch `codex/bootstrap-an-ipa-store` requires server-only
`SUPABASE_SECRET_KEY`, R2 credentials and `IPA_VERCEL_WORKER_ENABLED=true`.
Vercel supplies OIDC for Workflow/Sandbox. Do not set or commit personal Vercel tokens.
Existing upload readiness flags remain false until all upload release gates pass.

Run `node --env-file=.env.local scripts/test-vercel-sandbox.mjs` after `vercel link`
for an actual isolated runtime test. The script deletes the sandbox afterward.
Admin → IPA → versions shows recent worker runs and offers a Preview runtime test.
The test uses synthetic archives/CMS, not an Apple trust or OTA test.

## Queue and retention

Service-only RPCs atomically claim a specific receipt with a 15-minute token lease;
three scan attempts maximum, database-enforced exponential backoff. Workflow waits
16 minutes between retries to recover crashed leases. Stale tokens cannot finalize.
Successful metadata scans remain `quarantined_unverified`, never installable.
Rejected objects expire within one day; unverified objects after seven days.
Durable workflow deletion uses a separate 5-minute lease and signed DELETE.
The Admin view exposes cleanup failures. Bucket lifecycle is still a required
independent fallback: unacknowledged uploads have no workflow, and a failed durable
run cannot guarantee cleanup. Do not enable real uploads until R2 lifecycle is verified.

`supabase/tests/vercel_worker.sql` exercises claims, backoff, stale tokens, permissions
and deletion with synthetic rows in a rolled-back transaction.

## Limits / release blockers

- Direct upload currently limited to 100 MiB. No multipart/resumable upload.
- Metadata/CMS content integrity is not Apple certificate trust or nested code-signature verification.
- No Apple signing keys are needed or accepted. LCSign signing stays on owner's iPhone.
- A trusted verification runner and signed IPA/device tests are still required for Phase 5/6.
- R2 lifecycle and upload overwrite/replay protection must be verified before enabling uploads.
- Worker status is visible in Admin; external alert delivery is not configured.
- No production rollout or merge to main is authorized until release gates pass.

## Verified Preview evidence (2026-11-03)

- GitHub CI and Preview build pass for `f287593` and subsequent worker changes.
- Deployed workflow `wrun_41M6FBQYQX0GKCF8CS9RG5EFTM` completed the real
  Sandbox self-test (16 Python tests, deny-all networking).
- Protected Preview `/api/health`: 200; unauthenticated application calls to
  `/api/admin/worker` and `/api/admin/uploads/intakes`: 401 through Vercel CLI.
- Supabase rollback integration assertions for leases/backoff/cleanup pass.
- Full synthetic R2 pipeline is NOT yet verified: the first run failed before
  upload because a configured backend key contained an embedded newline.
  HTTP error text included the credential. Owner was instructed to revoke/rotate
  it; temporary local error files were deleted. Do not reuse that key.
- Backend credentials are now format-validated before Header construction;
  workflow step boundaries replace unexpected errors with fixed safe codes.
- Conditional `If-None-Match: *` is signed for all IPA PUTs. Actual R2 rejection
  of replay and Safari CORS with this header are pending verification.

After key rotation, redeploy Preview to load the new key, then run
`scripts/test-preview-workflow.mjs DEPLOYMENT_ID` for DB + runtime diagnostics.
For the complete synthetic pipeline, an operator creates a reserved 123-byte
receipt named `__AN_IPA_SYNTHETIC_DIAGNOSTIC__.ipa` via the service database,
then runs `scripts/test-preview-workflow.mjs DEPLOYMENT_ID RECEIPT_ID` within
10 minutes. The server supplies the constant synthetic bytes, verifies replay is
rejected, runs the scanner, checks fail-closed state, deletes the object through
cleanup leases, and confirms a subsequent GET is 404. No real IPA is involved.
A failed synthetic run never counts as verification of real upload or Apple trust.

Applied Supabase history: `20261102235950 vercel_worker_operations`; catalog
RPC history: `20261103001543 admin_catalog_drafts`. CLI-created local filenames
differ from server-assigned history versions; do not blindly replay migrations
against this existing project.
