# Kế hoạch triển khai

## Phase 1 — Audit và nền tảng

Đã audit repository trống; tạo tài liệu, cấu trúc, ignore và env mẫu. Xác nhận repository theo URL `ifywnx/an-ipa`; tên `an-ipa-store` chưa tồn tại theo API khi audit. GitHub CLI ifywnx có quyền ADMIN. Supabase có kết nối nhưng chưa xác định project đích. Vercel chưa được xác minh.

## Phase 2 — Database, Auth, Store, Admin

Bootstrap UI và domain được tạo; chưa hoàn thành phase. Tạo project Supabase riêng hoặc xác định project được phép dùng. Thiết kế migration cho toàn bộ bảng; chạy local Postgres, RLS tests với anon/user/publisher/admin. Triển khai login, session validation, CSRF, pagination và audit transaction trước bật mutation.

## Phase 3 — IPA

Upload quarantine với size limit; sandbox parser và ZIP safety; Info.plist binary/XML; macOS signing verification; kiểm tra profile/entitlements; version uniqueness. Chỉ dùng fixture tổng hợp trong tests, không commit IPA thật.

## Phase 4 — Device

Manual request với consent, rate limit và trạng thái unverified; admin evidence review; Apple adapter thật với idempotency và lỗi quota. Enrollment chỉ bật khi kiểm thử chữ ký, challenge, TTL, atomic single-use và replay thành công trên thiết bị thật. Xóa thiết bị phải revoke grants và có retention policy.

## Phase 5 — Distribution

HTTPS manifest, R2 signed URLs, kiểm tra URL, TestFlight/App Store allowlist. Mỗi cấp grant phải tái kiểm tra mọi điều kiện bằng dữ liệu backend đáng tin cậy. Kiểm thử thiết bị ngoài profile, profile hết hạn và thiết bị bị thu hồi.

## Phase 6 — Security gate và deployment

Bắt buộc: build/test/typecheck pass, dependency audit, secret scan toàn lịch sử, RLS integration tests, RBAC/IDOR/CSRF, upload abuse, signing verification trên macOS, enrollment replay, signed URL expiry/revocation, privacy deletion và audit redaction. Thiết lập branch protection + required CI trên GitHub. Preview trước production; production cần cấu hình và kiểm chứng riêng. Bootstrap checks không thay thế security review toàn hệ thống.

## Cần chủ website cung cấp/cấu hình

- Project Supabase đích, auth redirect URLs và email provider.
- R2 private bucket/CORS và Vercel project/domain.
- Apple Developer team/quyền API, secret manager và macOS signing worker.
- Chứng từ quyền phân phối, privacy policy và quy trình xử lý yêu cầu xóa.

Không gửi secrets trong chat hoặc commit. Cấu hình trực tiếp trong secret manager của dịch vụ.
