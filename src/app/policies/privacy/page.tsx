import type { Metadata } from "next";
import { PolicyDraftNotice } from "@/components/policy-draft-notice";

export const metadata: Metadata = { title: "Chính sách bảo mật" };

export default function PrivacyPage() {
  return <section className="reading">
    <p className="eyebrow">CHÍNH SÁCH</p>
    <h1>Chính sách bảo mật.</h1>
    <PolicyDraftNotice />
    <div className="panel">
      <h2>1. Dữ liệu cửa hàng thu thập</h2>
      <ul>
        <li><strong>UDID thiết bị</strong> do bạn chủ động gửi qua biểu mẫu hoặc luồng đăng ký thiết bị.</li>
        <li>Thông tin liên hệ và nội dung trao đổi khi bạn liên hệ hỗ trợ hoặc mua hàng.</li>
        <li>Dữ liệu kỹ thuật tối thiểu để vận hành website (ví dụ: thời điểm gửi yêu cầu, trạng thái xử lý yêu cầu).</li>
      </ul>
      <p>Cửa hàng <strong>không</strong> thu thập và không bao giờ yêu cầu: mật khẩu Apple ID, mã OTP, file chứng chỉ ký (.p12) hay khóa riêng tư của bạn.</p>
      <h2>2. Xử lý UDID — mục đích, lưu trữ, xóa</h2>
      <ul>
        <li><strong>Mục đích:</strong> UDID chỉ dùng để (a) đăng ký thiết bị của bạn với Apple trong giới hạn của tài khoản nhà phát triển, (b) đưa thiết bị vào provisioning profile để bản IPA ký lại cài được trên máy bạn, và (c) kiểm tra điều kiện cài đặt mỗi khi cấp liên kết cài đặt.</li>
        <li><strong>Lưu trữ:</strong> UDID được mã hóa khi lưu trên máy chủ. Giao diện khách hàng chỉ hiển thị 4 ký tự cuối; UDID đầy đủ chỉ được hệ thống máy chủ dùng khi kiểm tra điều kiện và không hiển thị công khai.</li>
        <li><strong>Thời gian lưu:</strong> UDID được giữ trong thời gian gói dịch vụ của bạn còn hiệu lực và tối đa 12 tháng sau lần sử dụng cuối, trừ khi bạn yêu cầu xóa sớm hơn hoặc pháp luật yêu cầu giữ lâu hơn.</li>
        <li><strong>Xóa theo yêu cầu:</strong> Bạn có thể yêu cầu xóa UDID và dữ liệu liên quan bất cứ lúc nào qua trang hỗ trợ. Cửa hàng xử lý trong vòng 30 ngày và xác nhận lại khi hoàn tất. Lưu ý: xóa UDID đồng nghĩa thiết bị không còn đủ điều kiện cài các bản IPA mới; việc xóa khỏi hệ thống của cửa hàng không tự động xóa bản đăng ký phía Apple trong năm thành viên hiện tại.</li>
        <li><strong>Chia sẻ:</strong> UDID được gửi cho Apple như một phần bắt buộc của việc đăng ký thiết bị Ad Hoc. Ngoài trường hợp đó và yêu cầu của cơ quan có thẩm quyền, cửa hàng không bán hoặc chia sẻ UDID cho bên thứ ba vì mục đích quảng cáo.</li>
      </ul>
      <h2>3. Quyền của bạn</h2>
      <p>Bạn có quyền hỏi cửa hàng đang lưu dữ liệu gì về mình, yêu cầu đính chính dữ liệu sai và yêu cầu xóa theo mục 2. Mọi yêu cầu gửi qua kênh hỗ trợ chính thức của cửa hàng.</p>
      <h2>4. Bảo mật</h2>
      <p>Dữ liệu được truyền qua HTTPS, lưu trong cơ sở dữ liệu có kiểm soát truy cập theo vai trò, và chỉ nhân sự vận hành được ủy quyền mới truy cập được khi cần xử lý yêu cầu của bạn.</p>
    </div>
  </section>;
}
