# Tài khoản khách hàng — kiến trúc và checklist kích hoạt

## Trạng thái

Đã triển khai đầy đủ ở mức code sau cờ `CUSTOMER_ACCOUNTS_ENABLED`
(mặc định `false`). Migration `20261105140000_customer_accounts.sql`
**CHƯA áp lên project Supabase thật**. Khi cờ tắt: các trang `/login`,
`/register` hiển thị trạng thái chưa kích hoạt, mọi route `/api/account/*`
trả 503 theo pattern chung, và mục đăng nhập không xuất hiện trong điều
hướng. Khách vãng lai vẫn dùng mọi luồng cũ bình thường.

## Quyết định kiến trúc

### Tái sử dụng Supabase Auth, tách tuyệt đối khỏi Admin

- Khách đăng ký/đăng nhập bằng chính Supabase Auth của project (email +
  mật khẩu, magic link, Google OAuth ở mức code flow). Không có hệ mật
  khẩu riêng nào được tự chế.
- Phiên khách dùng cookie riêng `__Host-an-customer`, khóa niêm phong
  riêng `CUSTOMER_SESSION_KEY_B64`, module riêng
  (`src/modules/auth/customer.ts`, `customer-server.ts`). Module khách
  **không hề tra cứu bảng `roles`**: mọi tài khoản đã xác thực email và
  không bị khóa đều là khách. Ngược lại, Admin vẫn yêu cầu cookie
  `__Host-an-admin` + khóa riêng + tra cứu `roles` role='admin' mỗi lần —
  nên phiên khách không bao giờ qua được route/trang admin (có test chứng
  minh ở `tests/customer-routes.test.ts`).
- Danh tính được kiểm tra lại với Supabase (`GET /auth/v1/user`) ở mọi
  lần đọc phiên. Cookie niêm phong chứa cặp access/refresh token: route
  handler tự đổi access token hết hạn bằng refresh token (xoay vòng),
  toàn bộ phiên bị giới hạn cứng 30 ngày kể từ lần đăng nhập đầu.
- Trang `/auth/callback` nhận token từ fragment URL (xác thực email,
  magic link, Google) và chuyển cho `POST /api/account/session` xác minh
  rồi mới niêm phong cookie.

### Liên kết chủ sở hữu đặt ở đâu và vì sao

- `manual_udid_requests.user_id` — đây là bản ghi thiết bị/yêu cầu UDID
  mà khách nhìn thấy: CẢ HAI đường tiếp nhận đều đổ về bảng này (nhập tay
  `source='manual_form'`, profile tự gửi `source='self_profile'`), và
  trang `/devices` vốn đã đọc từ đây.
- `guest_enrollments.user_id` — phiên trình duyệt ngắn hạn; callback của
  thiết bị đọc chủ sở hữu từ dòng phiên (trong SQL) để chuyển cho bản ghi
  pending tương ứng, client không bao giờ cung cấp user_id.
- Bảng `devices` canonical thuộc migration `platform_core` ngoài repo
  này nên migration mới **không tự ý sửa**; khi admin thăng một yêu cầu
  thành bản ghi thiết bị, chủ sở hữu lấy từ dòng yêu cầu.
- Liên kết chủ sở hữu chỉ là sổ sách: không đổi trạng thái yêu cầu, không
  xác minh thiết bị, không đưa vào điều kiện OTA. Có tài khoản ≠ thiết bị
  đáng tin.

### Truy cập dữ liệu: server route + service role, RLS làm phòng thủ chiều sâu

Theo đúng convention của repo (mọi bảng intake đều revoke khỏi browser
roles), khách không truy cập bảng trực tiếp: server route kiểm tra phiên
Supabase phía server rồi mới truy vấn bằng service role với phạm vi là
user_id **đã xác minh**. Thêm vào đó, migration cấp cho role
`authenticated` quyền SELECT giới hạn cột trên `manual_udid_requests`
(không gồm `udid_ciphertext`, `udid_hmac`, `request_token_hash`) kèm
policy `customer_read_own_udid_requests` (`user_id = auth.uid()`) — cùng
pattern với grant cột của bảng `apps` trong `harden_phase2_access`.

### Nhận lại thiết bị (claim) — chỉ bằng phiên trình duyệt đã gửi

Khách từng gửi UDID khi chưa đăng nhập có thể nhận về tài khoản **chỉ**
khi đăng nhập trên cùng trình duyệt còn giữ cookie tiếp nhận
(`an_manual_udid` hoặc `an_enrollment`). Server băm cookie token và các
RPC claim khớp theo hash đó trên các dòng **chưa có chủ**. Không tồn tại
đường claim bằng cách gõ lại UDID — tránh chiếm UDID của người khác.

### Yêu cầu xóa dữ liệu UDID

Trang tài khoản cho khách gửi yêu cầu xóa, ghi vào bảng mới
`customer_deletion_requests` (tối đa 1 yêu cầu đang mở mỗi tài khoản).
Repo cố ý không ghi vào bảng canonical `privacy_requests` vì schema thật
của nó không được ghi lại trong repo. Chủ cửa hàng xử lý thủ công:

1. Xem danh sách đang chờ ở `/admin/udids` (mục "Yêu cầu xóa dữ liệu
   UDID đang chờ").
2. Xóa các dòng `manual_udid_requests` (và phiên `guest_enrollments`
   liên quan) của user_id đó trong Supabase.
3. Cập nhật dòng yêu cầu: `status='processed'`, `processed_at=now()`.
4. Xác nhận lại cho khách — hạn xử lý 30 ngày theo bản nháp chính sách
   bảo mật. Lưu ý như chính sách đã ghi: xóa tại cửa hàng không xóa bản
   đăng ký phía Apple trong năm thành viên hiện tại.

## Checklist kích hoạt cho chủ sở hữu (chỉ làm được trên project thật)

1. **Áp migration** `20261105140000_customer_accounts.sql` vào project
   Supabase `an-ipa-store`, sau khi đối chiếu với lịch sử migration
   canonical (platform_core, privacy_requests, harden_phase2_access…).
2. **Cấu hình Supabase Auth** (Dashboard → Authentication):
   - Bật xác thực email (Confirm email = ON) — code coi email chưa xác
     thực là chưa đăng nhập được.
   - URL Configuration: Site URL = domain thật; Redirect URLs thêm
     `<APP_ORIGIN>/auth/callback`.
   - Kiểm tra rate limits của Auth và bật bảo vệ chống đoán mật khẩu.
   - (Tuỳ chọn) Google: tạo OAuth client trong Google Cloud Console,
     điền Client ID/Secret vào Providers → Google, và đảm bảo redirect
     URL của Supabase (`<SUPABASE_URL>/auth/v1/callback`) được khai trong
     Google Console. Code đã có sẵn nút "Tiếp tục với Google" — nút chỉ
     hoạt động sau bước này.
   - Lưu ý: Admin hiện được tạo thủ công trong Dashboard và gán role
     trong `public.roles`. Việc mở đăng ký công khai không tự cấp quyền
     admin cho bất kỳ ai — tuyệt đối không thêm trigger/policy nào tự gán
     role theo email hay metadata người dùng.
3. **Biến môi trường** (secret manager của hosting, không commit):
   `CUSTOMER_ACCOUNTS_ENABLED=true`, `CUSTOMER_AUTH_WAF_READY=true`
   (hoặc chỉ trên Preview được Vercel Authentication bảo vệ:
   `CUSTOMER_AUTH_PREVIEW_PROTECTED=true`), `CUSTOMER_SESSION_KEY_B64`
   (32 byte base64, khác khóa admin), và đảm bảo đã có `APP_ORIGIN`,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SECRET_KEY`.
4. **Kiểm chứng trên môi trường thật** trước khi mở cho khách: đăng ký
   tài khoản thử → xác thực email → đăng nhập → gửi UDID (nhập tay và
   profile) → kiểm tra user_id đã gắn → đăng xuất → gửi UDID vãng lai →
   đăng nhập lại cùng trình duyệt → claim → gửi yêu cầu xóa → kiểm tra
   hàng chờ phía admin hiển thị đúng email.

## Những gì chỉ làm được trên project/dashboard thật

- Áp migration và đối chiếu schema canonical (mục 1 ở trên).
- Mọi cấu hình Supabase Auth: xác thực email, redirect URL, rate limit,
  nhà cung cấp Google và khóa OAuth của Google.
- Test đăng nhập thật end-to-end (email xác thực, magic link, Google)
  trên thiết bị thật/Safari thật.
- Xử lý yêu cầu xóa dữ liệu (quy trình thủ công ở trên) cho tới khi có
  công cụ admin riêng.
