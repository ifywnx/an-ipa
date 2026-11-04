import type { Metadata } from "next";
import Link from "next/link";
import { PolicyDraftNotice } from "@/components/policy-draft-notice";

export const metadata: Metadata = { title: "Điều khoản sử dụng" };

export default function TermsPage() {
  return <section className="reading">
    <p className="eyebrow">CHÍNH SÁCH</p>
    <h1>Điều khoản sử dụng.</h1>
    <PolicyDraftNotice />
    <div className="panel">
      <h2>1. Cửa hàng bán gì</h2>
      <p>AN IPA STORE cung cấp các gói ứng dụng iOS dạng file IPA do chủ cửa hàng ký bằng công cụ LCSign trên thiết bị của chủ cửa hàng và phân phối theo hình thức Ad Hoc của Apple. Đây <strong>không phải</strong> kênh phân phối chính thức của Apple (App Store) và cũng không phải mua hàng trong ứng dụng gốc. Người mua được thông báo rõ điều này trước khi thanh toán.</p>
      <h2>2. Điều kiện để cài đặt được</h2>
      <ul>
        <li>Thiết bị của người mua phải có UDID được đăng ký với Apple và nằm trong provisioning profile của bản IPA đã ký.</li>
        <li>Chữ ký, profile phải còn hiệu lực và chưa bị Apple thu hồi tại thời điểm cài đặt.</li>
        <li>Người mua tự chịu trách nhiệm cung cấp UDID đúng của thiết bị sẽ cài đặt. Sai UDID dẫn tới không cài được không phải lỗi của cửa hàng nếu cửa hàng đã xử lý đúng UDID được cung cấp.</li>
      </ul>
      <h2>3. Giới hạn do Apple áp đặt</h2>
      <p>Apple giới hạn số thiết bị đăng ký mỗi năm cho mỗi loại thiết bị (tối đa 100 cho mỗi loại) và có quyền thu hồi chứng chỉ/profile bất cứ lúc nào. Khi giới hạn hoặc việc thu hồi xảy ra ngoài ý muốn, cửa hàng xử lý theo <Link href="/policies/refund-warranty">Chính sách đổi trả / bảo hành</Link>.</p>
      <h2>4. Hành vi bị cấm</h2>
      <ul>
        <li>Chia sẻ, bán lại liên kết cài đặt, file IPA hoặc tài khoản cho bên thứ ba khi chưa có thỏa thuận.</li>
        <li>Dùng ứng dụng vào mục đích vi phạm pháp luật hoặc xâm phạm quyền của bên thứ ba.</li>
        <li>Cố tình cung cấp UDID của thiết bị không thuộc quyền sở hữu/sử dụng hợp pháp của mình.</li>
      </ul>
      <h2>5. Thay đổi điều khoản</h2>
      <p>Khi điều khoản thay đổi, cửa hàng công bố bản mới tại trang này. Các đơn đã hoàn tất vẫn áp dụng điều khoản tại thời điểm mua, trừ khi pháp luật yêu cầu khác.</p>
    </div>
  </section>;
}
