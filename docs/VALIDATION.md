# Báo cáo bootstrap — 2026-11-03

## Phase 1

Tạo README.md, ARCHITECTURE.md, IMPLEMENTATION_PLAN.md, .gitignore, .env.example, docs/AUDIT.md và docs/DATA_MODEL.md. Audit GitHub xác nhận repo trống; không có file hiện có bị sửa. Chưa xác định Supabase/Vercel project đích.

## Phase 2 — nền tảng, chưa hoàn thành toàn bộ phase

Tạo Next.js/TypeScript/Tailwind, store empty state, hướng dẫn Finder, trang hỗ trợ, trang quản trị chưa kích hoạt và health endpoint. Tách domain thiết bị, OTA eligibility và Apple adapter fail-closed. Không triển khai Auth/database thật, không thu thập UDID, không có upload/signing/install endpoint.

## Kiểm tra bootstrap

- 14 unit tests pass: UDID format, RBAC transition, revocation, OTA denial conditions, Apple chưa cấu hình.
- TypeScript: pass.
- Production build: pass sau khi sửa package type sang ESM.
- npm audit --omit=dev: 0 vulnerabilities tại thời điểm kiểm tra.
- Baseline tracked-file scan: pass; không có private key hoặc tài sản IPA/provisioning được commit.
- CI: có workflow test/typecheck/build/security/dependency audit, không có deployment.

Chưa kiểm thử: giao diện trên Safari/iPhone thật, Auth/RLS, Apple integration, signing verification, enrollment CMS/replay, upload parser, storage signed URLs và production. Domain unit tests dùng dữ liệu tổng hợp, không chứng minh Apple chấp nhận thiết bị hoặc IPA.

## Giới hạn và bước tiếp theo

Cần Supabase project đích, R2, Apple Developer quyền/credentials qua secret manager, macOS signing worker và Vercel project. Xem IMPLEMENTATION_PLAN.md. Không deploy hoặc merge mã ứng dụng vào main ở bootstrap.
