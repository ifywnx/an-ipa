# Tạo kho Cloudflare R2 riêng tư cho AN IPA STORE

## Tình trạng hiện tại

Đăng nhập Admin trên iPhone đã được người vận hành kiểm tra thành công trong Vercel Preview. Cấu hình R2 hiện **chưa có**; upload vẫn tắt. Chủ cửa hàng ký IPA bằng **LCSign ngay trên iPhone**, không đưa P12 hay private key lên website, Vercel hoặc Cloudflare.

## 1. Tạo bucket (Cloudflare Dashboard)

1. Đăng nhập https://dash.cloudflare.com/ và mở **Storage & databases → R2 Object Storage → Overview**.
2. Kích hoạt R2 nếu lần đầu sử dụng và kiểm tra điều khoản / mức sử dụng; chưa bắt buộc tạo dịch vụ trả phí vượt hạn mức.
3. Chọn **Create bucket**. Tên đề xuất: \`an-ipa-quarantine\`; nếu đã tồn tại, chọn tên riêng khác hợp lệ.
4. Không bật public access, không bật \`r2.dev\` và không gắn public custom domain. **Bucket phải riêng tư**.
5. Cấu hình lifecycle xóa đối tượng bỏ dở trong \`quarantine/\` sau thời gian lưu trữ được chấp thuận; chưa xem đây là kho phát hành.

## 2. CORS cho Safari iPhone (bucket → Settings → CORS Policy)

Dán JSON này tại giao diện **CORS Policy** của Cloudflare. \`AllowedOrigins\` phải trùng **chính xác** origin của website đang dùng. Nếu đổi domain/nhánh, sửa chính sách theo; không dùng \`*\`.

\`\`\`json
[
  {
    "AllowedOrigins": [
      "https://an-ipa-store-git-codex-bootst-4559aa-annguyenub0-8186s-projects.vercel.app"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
\`\`\`

CORS chỉ cho phép origin trình duyệt. CORS **không phải** kiểm soát truy cập thay cho presigned URL, Admin Auth hoặc bucket private.

## 3. Cấp R2 API token quyền tối thiểu

Tại R2 **Overview → Manage API Tokens**, tạo token chỉ cho **bucket cụ thể** (Object Read & Write nếu worker cần đọc/kiểm tra). Không dùng token toàn tài khoản. Lưu **Access Key ID** và **Secret Access Key** chỉ ở trình quản lý bí mật của Vercel; không chia sẻ vào chat, GitHub, ảnh chụp màn hình hoặc frontend.

Bạn cũng sẽ cần **Cloudflare Account ID** 32 ký tự hex tại R2 Overview.

## 4. Biến môi trường cho Vercel Preview

Trong Vercel project \`an-ipa-store\` → Settings → Environment Variables, tạo biến dành **riêng Preview / Specific Git Branch**: \`codex/bootstrap-an-ipa-store\`.

| Key | Value | Visibility |
|---|---|---|
| \`R2_ACCOUNT_ID\` | Cloudflare Account ID, không phải token | Encrypted |
| \`R2_BUCKET\` | Bucket bạn vừa tạo | Encrypted |
| \`R2_ACCESS_KEY_ID\` | R2 Access Key ID | Sensitive |
| \`R2_SECRET_ACCESS_KEY\` | R2 Secret Access Key | Sensitive |

**Không bật** \`R2_PRIVATE_UPLOAD_ENABLED\`, \`R2_PRIVATE_WAF_READY\`, \`R2_QUARANTINE_LIFECYCLE_READY\`, \`R2_SCANNER_READY\` khi worker quét tự động, kiểm soát quota và thử nghiệm R2 thực chưa sẵn sàng. Các cờ này mặc định FALSE, không thêm vào Preview cũng được.

## 5. Chốt điều kiện để upload thật

- Server phải xác minh Admin ở mỗi lượt xin cấp URL và hạn mức theo user/IP; tạo bản ghi intake trước khi cấp quyền.
- Trước khi bật upload, kiểm chứng chữ ký presigned \`Content-Length\` trên R2 thật và Safari iPhone với file tổng hợp (không phải IPA thật) vì \`Content-Length\` do trình duyệt tự đặt.
- R2 **phải chỉ nhận IPA vào quarantine**, không có URL tải công khai. Một HTTP 2xx của \`PUT\` chỉ chứng minh đối tượng đã nhận; không phải xác minh Apple code-sign hay quyền OTA.
- Worker phải quét ZIP/binary plist, mã độc, profile CMS, binary code signatures/entitlements; đối chiếu checksum/size với metadata đã cấp grant, lưu kết quả kiểm tra và giới hạn việc phát hành.
- Giới hạn upload đơn hiện tại **100 MiB**. IPA lớn hơn cần multipart/resumable trên Safari.
- Thử triển khai và xác nhận đăng nhập/đường upload chỉ trong Preview trước khi merge lên main.

## Tài liệu chính thức

- https://developers.cloudflare.com/r2/buckets/create-buckets/
- https://developers.cloudflare.com/r2/buckets/cors/
- https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- https://developers.cloudflare.com/r2/get-started/s3/
