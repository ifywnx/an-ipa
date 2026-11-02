import Link from "next/link";
export default function Register(){ return <section className="reading">
  <p className="eyebrow">THIẾT BỊ · KHÔNG CẦN TÀI KHOẢN</p><h1>Đăng ký thiết bị iPhone.</h1>
  <p className="lead">Bạn có thể xem ứng dụng mà không đăng nhập. Với ứng dụng Ad Hoc, thiết bị phải được phép và có trong provisioning profile của bản IPA đã ký.</p>
  <div className="panel notice" role="status"><h2>Chưa mở thu thập UDID</h2>
  <p>Không có chức năng JavaScript nào tự đọc UDID trên Safari. Hệ thống sẽ chỉ cung cấp profile lấy UDID khi triển khai đúng cơ chế Apple, xác minh CMS/challenge và có sự đồng ý của người dùng. Chúng tôi không phát profile giả.</p></div>
  <div className="panel"><h2>Phương án nhập UDID thủ công</h2>
    <ol><li>Lấy UDID qua Finder/thiết bị và phương thức được Apple hỗ trợ hoặc từ nhà quản trị thiết bị hợp lệ.</li>
    <li>Khi biểu mẫu bảo mật được mở, gửi UDID với sự đồng ý về mục đích lưu giữ và quyền xóa.</li>
    <li>Yêu cầu được gắn trạng thái chờ xác minh; chủ website kiểm tra việc đăng ký với Apple và cập nhật profile.</li>
    <li>Chỉ sau khi IPA đã ký lại và chứa UDID hợp lệ, website mới có thể xét cấp liên kết cài OTA.</li></ol>
    <p>Hiện tại chưa có biểu mẫu gửi dữ liệu lên server. Không gửi UDID qua trang hỗ trợ hoặc nơi công khai.</p></div>
  <p><Link href="/apps">Xem danh mục ứng dụng</Link></p>
</section>; }
