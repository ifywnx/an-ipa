import type { Metadata } from "next";
import { PolicyDraftNotice } from "@/components/policy-draft-notice";

export const metadata: Metadata = { title: "Chính sách đổi trả / bảo hành" };

export default function RefundWarrantyPage() {
  return <section className="reading">
    <p className="eyebrow">CHÍNH SÁCH</p>
    <h1>Chính sách đổi trả / bảo hành.</h1>
    <PolicyDraftNotice />
    <div className="panel">
      <h2>1. Nguyên tắc chung</h2>
      <p>Gói mua gắn với <strong>một UDID của một thiết bị cụ thể</strong> và có thời hạn theo mô tả gói tại thời điểm mua. &ldquo;Bảo hành&rdquo; tại cửa hàng nghĩa là: trong thời hạn gói, nếu sự cố thuộc trách nhiệm ở mục 2 xảy ra, cửa hàng xử lý lại miễn phí (ký lại, cấp lại liên kết cài đặt hoặc cấp chỗ đăng ký mới) thay vì yêu cầu bạn mua lại.</p>
      <h2>2. Trường hợp được bảo hành</h2>
      <ul>
        <li>Chứng chỉ ký hoặc provisioning profile bị Apple thu hồi trong thời hạn gói → cửa hàng ký lại bằng chứng chỉ/profile mới và cấp lại liên kết cài đặt.</li>
        <li>Profile hết hạn sớm hơn thời hạn gói đã cam kết do lỗi xử lý của cửa hàng → gia hạn tương ứng phần thời gian bị mất.</li>
        <li>Bản IPA cửa hàng cung cấp bị lỗi ký (chữ ký không hợp lệ, thiếu thành phần) khiến không cài được dù UDID đúng → ký lại hoặc hoàn tiền nếu không khắc phục được trong 7 ngày.</li>
      </ul>
      <h2>3. Trường hợp không thuộc bảo hành</h2>
      <ul>
        <li>Bạn cung cấp sai UDID, hoặc cài lên thiết bị khác với UDID đã đăng ký.</li>
        <li>Bạn đổi thiết bị mới — đây là đăng ký mới (UDID mới), xử lý theo giá và thời gian đăng ký hiện hành; Apple giới hạn tổng số thiết bị mỗi năm nên cửa hàng không cam kết có chỗ ngay lập tức.</li>
        <li>Ứng dụng gốc thay đổi chính sách, ngừng hỗ trợ, hoặc lỗi nằm trong bản thân ứng dụng (không phải lỗi ký/phân phối).</li>
        <li>Thiết bị đã jailbreak hoặc bị chỉnh sửa hệ thống khiến việc cài đặt ngoài App Store không ổn định.</li>
      </ul>
      <h2>4. Hoàn tiền</h2>
      <ul>
        <li>Hoàn 100% nếu cửa hàng không hoàn tất đăng ký/cấp bản cài đầu tiên cho đúng UDID bạn cung cấp trong thời gian đã hẹn.</li>
        <li>Không hoàn tiền cho phần thời gian đã sử dụng khi sự cố thuộc mục 3, hoặc khi bạn yêu cầu dừng dịch vụ giữa chừng mà không có lỗi của cửa hàng.</li>
        <li>Yêu cầu hoàn tiền được xử lý qua kênh hỗ trợ, kèm mã yêu cầu UDID hoặc bằng chứng giao dịch; thời gian xử lý tối đa 7 ngày làm việc sau khi xác minh.</li>
      </ul>
      <h2>5. Cách yêu cầu hỗ trợ</h2>
      <p>Gửi yêu cầu qua trang hỗ trợ của cửa hàng, kèm mã yêu cầu thiết bị (nếu có) và mô tả sự cố. Cửa hàng phản hồi kèm hướng xử lý và thời gian dự kiến trước khi thực hiện thay đổi nào ảnh hưởng tới gói của bạn.</p>
    </div>
  </section>;
}
