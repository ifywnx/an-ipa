import "server-only";

/**
 * Server-only adapter from persistent records to OtaEvidence.
 *
 * SCHEMA ASSUMPTIONS — READ BEFORE WIRING THE REAL PROJECT.
 * The canonical Supabase project `an-ipa-store` already contains the
 * platform tables (see docs/PHASE2_DATABASE.md): apps, app_versions,
 * ipa_assets, distribution_channels, devices and provisioning_profiles.
 * Their live column lists are NOT fully recorded in this repository, so the
 * row interfaces below follow docs/DATA_MODEL.md plus the columns the
 * repository already relies on (apps: slug/name/developer/description/
 * category/published). Every mapping below is fail-closed: a missing table,
 * missing column or missing row degrades to denials, never to approval.
 * Points that MUST be reconciled against the live project before use:
 *   - devices.status vocabulary, identity_verified / apple_registered flags
 *     and the udid_ciphertext format (assumed: enrollment/secure.ts AES-GCM
 *     sealed canonical UDID, same key as manual intake);
 *   - app_versions.provisioning_profile_id / ipa_asset_id links, and whether
 *     publication is a `published` boolean or a `status` text;
 *   - provisioning_profiles.provisioned_udids (assumed: canonical UDID text
 *     array as extracted by the profile intake in workers/profile_intake.py);
 *   - distribution_channels.rights_reviewed as the recorded distribution
 *     rights review for both `distributionAuthorized` and the grant-level
 *     rights check;
 *   - verifier_attestations is a NEW table proposed by migration
 *     20261105090000 (not yet applied); without it every signature field
 *     stays false and OTA stays denied.
 * Browser payloads must never supply these fields; this module is the only
 * place evidence may be assembled, and it runs with the service role.
 */

export * from "./evidence-map";
