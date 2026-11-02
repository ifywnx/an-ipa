import Link from "next/link";
export default function Register(){return <section className="reading">
  <p className="eyebrow">KHÔNG CẦN ĐĂNG NHẬP</p><h1>Đăng ký iPhone để cài app.</h1>
  <p className="lead">Với app Ad Hoc, UDID phải có trong provisioning profile của IPA đã ký. LCSign chỉ cài trên iPhone của chủ cửa hàng, không phải iPhone của khách.</p>
  <Link href="/udid" className="button">Xem hướng dẫn lấy UDID</Link>
  <div className="panel"><h2>Hai phương thức hợp lệ</h2>
    <ol><li><strong>Profile Service đã xác minh:</strong> tạo token một lần, chấp thuận trên iPhone, chỉ công bố UDID khi máy chủ đã kiểm chứng phản hồi thiết bị theo Apple.</li>
    <li><strong>Nhập thủ công:</strong> lấy UDID qua Finder hoặc nguồn đáng tin cậy rồi gửi theo biểu mẫu có kiểm soát. Hiện chưa mở gửi UDID thủ công, tránh lộ dữ liệu nhạy cảm.</li></ol>
    <p>Việc lấy UDID không tự đăng ký thiết bị với Apple Developer. Nếu profile chưa có UDID, chủ cửa hàng phải cập nhật profile và ký IPA lại bằng LCSign trên iPhone.</p></div>
</section>}
