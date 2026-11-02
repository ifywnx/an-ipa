# Mô hình dữ liệu dự kiến — chưa áp dụng migration

Mọi bảng có UUID PK, created_at, updated_at. FK phải có chỉ mục. Audit append-only; xóa dữ liệu thiết bị theo retention policy, không giữ UDID nguyên văn trong logs.

| Bảng | Ràng buộc và truy cập |
|---|---|
| profiles | user_id unique FK auth.users; user chỉ đọc/cập nhật trường hồ sơ được phép |
| roles | user_id + role unique; backend quản trị ghi, user không tự cấp role |
| apps | slug unique, publisher_id FK; chỉ published public |
| app_versions | app_id + build unique; metadata xác minh server |
| ipa_assets | version_id FK, sha256, object key private; không public |
| distribution_channels | version_id + channel unique; chỉ bản phát hành được duyệt |
| devices | owner_id FK, UDID encrypted + keyed lookup hash unique; chỉ owner/admin |
| device_enrollment_sessions | token hash unique, challenge hash, expiry, consumed_at; backend-only |
| device_registration_requests | device_id FK, consent, verification status; owner đọc, backend ghi |
| provisioning_profiles | UUID unique, team, expiry, object reference private; không chứa private key |
| signing_certificates_metadata | fingerprint unique, expiry, team; metadata-only |
| installation_events | grant/version/device FK; không khẳng định cài thành công từ click |
| app_permissions | app_id + principal unique; quản trị ghi |
| audit_logs | actor, action, target ID, redacted payload; backend-only append |

Migration thực sẽ được tạo bằng Supabase CLI sau khi có môi trường database kiểm thử; không đánh dấu RLS hoàn thành bằng tài liệu này.
