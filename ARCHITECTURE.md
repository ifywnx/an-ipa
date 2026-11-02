# Kiến trúc AN IPA STORE

## Quyết định

Next.js App Router + TypeScript phục vụ web và API. Business logic nằm trong `src/modules`, độc lập UI. Supabase PostgreSQL/Auth quản lý dữ liệu và danh tính; R2 private bucket lưu IPA. Chưa cấu hình dịch vụ ngoài ở bootstrap.

## Ranh giới tin cậy

Browser chỉ dùng publishable key. Backend xác minh session và role từ nguồn tin cậy; không dùng user_metadata để phân quyền. Mỗi bảng public phải có RLS, quyền theo chủ sở hữu và kiểm thử truy cập chéo user. Admin không được tự nâng quyền từ client.

IPA vào quarantine private qua upload hạn dung lượng. Worker sandbox kiểm tra ZIP traversal/bomb, Info.plist, hash, chữ ký, provisioning và entitlement. Kiểm tra chữ ký thực chạy trong macOS worker bằng công cụ Apple; Node không tự tuyên bố IPA hợp lệ. Chỉ artifact đã được worker xác minh mới đủ điều kiện xét xuất bản.

Mỗi install request kiểm tra lại trạng thái thiết bị, Apple registration, quyền phân phối, profile expiry, UDID, bundle và entitlement. Signed URL ngắn hạn không đảm bảo thu hồi tức thì; cần TTL ngắn và vô hiệu grant khi revoke. Không coi click liên kết là cài đặt thành công.

## Đăng ký thiết bị

Ưu tiên enrollment sau khi xác nhận điều kiện Apple và cơ chế xác minh CMS/chứng thư. Không sinh mobileconfig hoặc callback giả. Fallback là hướng dẫn Finder; yêu cầu nhập thủ công phải ở trạng thái pending/unverified. Duyệt nội bộ khác với Apple registration. Hai trạng thái phải lưu riêng.

## Tích hợp

Apple adapter phải trả unavailable khi chưa có credentials. Signing key trong secret manager hoặc signing worker, không trong database thông thường. Vercel chỉ chạy web/API; không thực hiện ký IPA trong serverless request. Không chọn Supabase project khác chỉ vì tài khoản có quyền truy cập.

## Nguồn tham khảo

- https://nextjs.org/docs/app/getting-started/installation
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://developer.apple.com/documentation/appstoreconnectapi/devices

Xem `docs/DATA_MODEL.md` cho thiết kế dữ liệu và `docs/AUDIT.md` cho quyền truy cập.
