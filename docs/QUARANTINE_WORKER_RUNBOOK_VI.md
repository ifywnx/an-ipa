# Phase 3 — Vận hành worker kiểm tra IPA (chưa kích hoạt)

## Phân chia trách nhiệm

- **iPhone + LCSign**: Chủ website tự ký IPA. Không đưa P12, private key hoặc mật khẩu chứng chỉ lên máy chủ.
- **Vercel Preview**: Giao diện Admin, đăng nhập, API cấp upload vào R2. Hiện cờ upload thật đều tắt.
- **Supabase**: Lưu bản ghi, hạn mức, lượt xác nhận, hàng chờ và trạng thái quét.
- **Cloudflare R2**: Kho riêng tư \`quarantine/\`, không mở public domain.
- **Worker riêng biệt**: Chạy Python + OpenSSL trong container cách ly, tải từng IPA về /tmp để kiểm tra metadata, xóa file tạm. Không có HTTP listener.

## Trình tự sau khi đủ điều kiện vận hành

1. Admin chọn IPA đã ký bằng LCSign trên iPhone.
2. API tạo bản ghi \`reserved\` và URL PUT có hạn ngắn sau khi xác thực/quota.
3. Safari gửi IPA trực tiếp vào R2. API nhận xác nhận từ trình duyệt và đổi sang \`uploaded_pending_scan\`. Đây **không phải** bằng chứng upload thành công.
4. Worker bằng service key riêng kiểm tra \`claim_ipa_scan\`, tải chính đối tượng \`quarantine/<receipt-id>.ipa\` từ R2 và so khớp số byte/hash. **Không tin dữ liệu client**.
5. Worker dùng \`ipa_inspector.py\` để phân tích ZIP/Info.plist/CMS. Đối tượng lỗi bị gắn \`rejected\`. Đối tượng đạt các bước sơ bộ chỉ được gắn \`quarantined_unverified\`; chữ ký Apple và quyền OTA vẫn \`false\`.
6. \`finish_ipa_scan\` xác thực lease token để worker cũ không ghi đè kết quả worker mới. Có tối đa ba lượt thử, các lượt hết hạn bị đánh dấu từ chối.

## Cách chuẩn bị môi trường worker

Dùng host chạy container riêng biệt (ví dụ Railway Cron hoặc một job runner tương tự). Nếu chạy Docker, **build từ thư mục \`workers/\`** (Dockerfile và cả hai file Python cùng thư mục). Chọn công việc chạy theo lịch, không public HTTP port.

Trong secret manager của host worker (KHÔNG đưa vào GitHub hoặc ChatGPT), cung cấp:

- \`IPA_QUARANTINE_WORKER_ENABLED=true\` **chỉ sau khi cấu hình vận hành**
- \`SUPABASE_URL\` — HTTPS URL Supabase của AN IPA STORE
- \`SUPABASE_SECRET_KEY\` — secret backend riêng cho worker, không dùng key trong trình duyệt
- \`R2_ACCOUNT_ID\`, \`R2_BUCKET\`, \`R2_ACCESS_KEY_ID\`, \`R2_SECRET_ACCESS_KEY\` — kho riêng tư; hạn chế quyền vào đúng bucket
- Không cấu hình \`P12\`, private key, chứng chỉ Apple hoặc mật khẩu LCSign

Mỗi job chỉ xử lý một bản ghi và kết thúc. Cron cần kích hoạt lặp lại có giám sát. Có thể chạy nhiều lượt song song vì SQL dùng \`FOR UPDATE SKIP LOCKED\`, nhưng giới hạn tổng CPU/RAM/bandwidth để tránh quá tải và chi phí bất ngờ.

## Điều kiện bắt buộc trước khi bật upload thật

- Triển khai worker **thành công trên môi trường tin cậy**, bật giám sát thất bại, thử job giả và làm sạch file.
- Có timeout, disk quota, tối thiểu 100 MiB + dung lượng tạm phụ, memory limit, outbound chỉ đến Supabase và R2; ngăn worker chạy code nhúng trong IPA.
- Thiết lập lifecycle xóa object bỏ dở và chính sách lưu trữ IPA. **Mã hiện tại chưa tự xóa đối tượng IPA trên R2** sau khi quét, do đó phải có lifecycle phù hợp.
- Kiểm thử mã độc, ZIP độc hại, profile hết hạn, sai size/hash, 404/mất kết nối, cùng thao tác upload thực trên Safari iPhone.
- Xác minh **chuỗi chứng chỉ Apple thật**, Mach-O và các chữ ký lồng nhau, entitlement, profile chứa UDID thiết bị; sau đó thử OTA hợp lệ trên iPhone thật.
- **Không bật** các biến \`R2_PRIVATE_UPLOAD_ENABLED\`, \`R2_SCANNER_READY\`, \`R2_PRIVATE_WAF_READY\`, \`R2_QUARANTINE_LIFECYCLE_READY\` cho đến khi các bước bảo mật được xác nhận. Không merge production.

## Trạng thái đã kiểm tra

- Đã kiểm tra upload file mẫu qua trình duyệt iPhone, đối chiếu byte và xóa trên R2.
- Đã áp dụng DB migrations thực tế: \`20261102232630 ipa_quarantine_worker_transitions\` và \`20261102233258 reap_stale_ipa_scan_leases\`. Tên file migration trong repo khác phiên bản do Supabase MCP cấp; **đối chiếu/mapping lịch sử migration khi dùng CLI**, tránh áp dụng lại.
- Đã thử quy trình claim/finish trong giao dịch rollback, không tạo IPA hay bản ghi thật.
- CI chạy các fixture tổng hợp. Worker chưa được deploy, chưa thử với IPA LCSign thật.

**Không gọi đây là bản FINAL phân phối ứng dụng.**
