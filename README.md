# AN IPA STORE

Nền tảng phân phối ứng dụng iOS có quyền phân phối hợp lệ.

## Trạng thái

Repository bootstrap: Next.js + TypeScript, module domain và kiểm tra an toàn. Chưa phải hệ thống phân phối production. Chưa kết nối Supabase, Apple hoặc R2; không phát hành IPA, không thu UDID và không báo đăng ký thành công giả.

## Chạy cục bộ

Node.js 22 LTS hoặc mới hơn.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

```sh
npm test
npm run typecheck
npm run build
npm run security:check
npm audit --omit=dev
```

## Cấu trúc

- `src/app`: store, hướng dẫn đăng ký, trạng thái quản trị và health endpoint.
- `src/modules`: quy tắc thiết bị, kiểm tra điều kiện OTA, hợp đồng tích hợp.
- `tests`: kiểm thử quy tắc an toàn; không thay thế kiểm thử Apple thật.
- `scripts`: kiểm tra file nhạy cảm trước commit/CI.
- `docs`: audit, mô hình dữ liệu và báo cáo kiểm tra.

Đọc ARCHITECTURE.md và IMPLEMENTATION_PLAN.md trước khi mở rộng. Không đặt P12, private key, provisioning profile hoặc IPA thật trong repository. `.gitignore` không bảo vệ file đã được tracked; luôn chạy security check.

## Git workflow

Làm việc trên `codex/*`, review và CI trước merge. Không force push main. Chưa có workflow deploy; production bị chặn đến khi security gate trong kế hoạch được hoàn thành.

## Phase 2 — cập nhật 2026-11-03

- Danh mục /apps, trang chi tiết /apps/[slug], tìm kiếm và lọc danh mục; dữ liệu chỉ đọc từ Supabase REST public projection khi được cấu hình.
- Giao diện /auth và /admin đang khóa; **không có đăng nhập, phân quyền hoặc thao tác quản trị thực**.
- Migration SQL `supabase/migrations/20261103000100_phase2_core.sql` có RLS mặc định chặn. Chưa chạy trên Supabase; xem `docs/PHASE2_DATABASE.md`.
- Chưa có IPA thực, Apple registration, signed URL, hoặc production deployment. Không đưa secret vào NEXT_PUBLIC_*.
- Mọi commit được thực hiện trên nhánh phát triển và review qua PR #1; `main` không bị thay đổi.
