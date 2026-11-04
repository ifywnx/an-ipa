# Kiến trúc AN IPA STORE — LCSign on iPhone

## Ranh giới trách nhiệm

- **LCSign trên iPhone của chủ cửa hàng**: ký IPA bằng chứng chỉ/provisioning profile hợp lệ mà chủ sở hữu quản lý. AN IPA STORE **không ký hoặc ký lại IPA**; không lấy, yêu cầu, lưu P12, mật khẩu chứng chỉ, private key hay Apple signing key.
- **Admin mobile (iPhone Safari)**: tải IPA đã ký vào vùng lưu trữ riêng (quarantine), xem kết quả kiểm tra, quản lý nhiều app/build, UDID và danh sách phiên bản. Chỉ Admin được ghi; Auth/RBAC phải được xác minh server-side.
- **IPA inspector**: quét cấu trúc ZIP theo giới hạn kích cỡ/tỷ lệ nén; đọc Info.plist (XML và binary), kiểm tra embedded.mobileprovision, expiration, Team ID, allowed UDIDs, bundle ID và entitlements. Đây là *phân tích metadata*, không phải kết luận chữ ký hợp lệ.
- **Verifier độc lập**: xác minh chữ ký code của ứng dụng và profile chain/trust/entitlements bằng công cụ thích hợp trong worker biệt lập. Nếu chưa có verifier đáng tin cậy, artifact luôn ở `verification_pending`/blocked; không hiển thị nút cài đặt. Có thể dùng macOS **chỉ để xác minh** (không ký) nếu hạ tầng cho phép; không bắt buộc chủ cửa hàng dùng MacBook để ký.
- **Public Store**: không cần login để duyệt ứng dụng. Cấp OTA sau khi backend xác minh đúng device, đúng IPA build/profile và grant ngắn hạn. Cấm dùng client-supplied `signatureVerified` hay `profileUdids` làm chứng cứ.

## Chuỗi dữ liệu

```text
LCSign (owner iPhone) --[signed IPA only]--> Admin mobile
  --> authenticated resumable upload (quarantine/private object storage)
  --> ZIP+plist inspection (untrusted)
  --> independent signature+provisioning trust verification
  --> approval of authorized distribution rights
  --> App / AppVersion / Artifact verified and published
  --> per-device entitlement check + time-bound install grant
  --> HTTPS manifest.plist + short-lived HTTPS IPA URL
  --> iOS itms-services:// download-manifest
```

No IPA file, profile, private key, signing certificate or UDID is committed to GitHub.

## Devices / UDID

- Manual UDID: format-check only; mark `unverified` and request consent. Manual input is not proof of device possession, not equivalent to Apple registration.
- Supported Apple profile service: requires TLS, informed consent, unique short-lived challenge, CMS verification against a trusted device chain, replay protection and verifiable device identity. Never fabricate a `.mobileconfig`, CMS callback or an automatic UDID. This feature remains **disabled** until end-to-end validation on real devices.
- UDIDs are sensitive: envelope encryption, keyed lookup HMAC, masked display, retention/delete flow, rate limiting, no plaintext logs.
- For Ad Hoc: Apple developer account device registration and regenerated provisioning profile are **separate** from collecting UDID. The owner imports updated profile into LCSign on iPhone and signs a *new IPA build*; previously signed files cannot gain devices merely by updating the website.
- Purchased "one-year certificate" does not identify distribution type: check provisioning `ProvisionedDevices`, `ProvisionsAllDevices`, entitlements and actual issuer before enabling any channel. Never equate enterprise certificate with unrestricted public distribution.

## OTA

Server only builds an OTA manifest when the dual release gate is open
(`OTA_INSTALL_ENABLED` and `OTA_INSTALL_PIPELINE_READY`, both closed by
default) **and**:
1. Version/artifact are published through an implemented, published channel, IPA checks completed, signature trust verified by independent verifier; license/distribution rights confirmed.
2. Device is approved and, for the selected Ad Hoc policy, **registered with Apple** and present in the verified embedded provisioning profile; profile/certificate unexpired; bundle ID and entitlements match.
3. HTTPS IPA and HTTPS manifest are served from approved domains with short grant expiry; authorization is re-checked at grant time. Revocation of already-delivered URLs may not be immediate. A download/click is *not* evidence of installation.

For Enterprise/TestFlight/App Store, separate channel policies apply; no shortcut bypasses Apple terms or entitlement checks. The current implementation intentionally generates no public install grant.

## Infrastructure

Next.js/TypeScript storefront + admin, Supabase Auth/Postgres RLS for trusted metadata, R2 private bucket for IPA, out-of-band untrusted-file scanning and signature verification. Serverless request handlers do **not** sign IPA or run large untrusted archive processing. Keep `main` protected; no production deployment until all security gates pass.

## References

- https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile/
- https://developer.apple.com/help/account/provisioning-profiles/edit-download-or-delete-profiles
- https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/iPhoneOTAConfiguration/profile-service/profile-service.html
- https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles

## Vercel worker (Phase 4)

See [Vercel worker](docs/VERCEL_WORKER.md). Durable Workflow orchestrates temporary
Sandbox microVMs. Only per-object signed GET URLs enter the parser environment;
service credentials remain in Vercel Functions. Metadata success remains quarantined.
Supabase owns scan/cleanup leases and retry budget. R2 lifecycle remains a release gate.
