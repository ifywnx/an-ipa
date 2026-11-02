import Link from "next/link";
export default function UdidAdminPage() {
  return <section className="reading admin-mobile">
    <Link className="back-link" href="/admin">← Quay lại Admin</Link>
    <p className="eyebrow">QUẢN LÝ THIẾT BỊ</p><h1>UDID và profile.</h1>
    <p className="lead">Trạng thái yêu cầu là riêng biệt: nhận UDID, xác minh thiết bị, đăng ký với Apple, có trong provisioning profile và đủ điều kiện cài.</p>
    <div className="panel notice"><h2>Chưa hiển thị danh sách thiết bị</h2>
    <p>Phải hoàn thành đăng nhập Admin xác thực, kiểm tra RLS, mã hóa UDID và bảo vệ quyền riêng tư trước khi xem hoặc chỉnh sửa bất kỳ dữ liệu thật nào.</p></div>
    <div className="panel">
      <h2>Quy trình cập nhật profile</h2>
      <ol><li>Xem yêu cầu chưa xác minh và xin quyền xử lý UDID.</li>
      <li>Xác minh thiết bị rồi thực hiện đăng ký hợp lệ với Apple; duyệt nội bộ không đồng nghĩa Apple đã đăng ký.</li>
      <li>Tạo mới provisioning profile có UDID thiết bị.</li>
      <li>Đưa profile vào LCSign trên iPhone và ký lại từng IPA cần phân phối.</li>
      <li>Upload lại IPA, đợi xác minh profile/chữ ký, rồi mới cấp link OTA.</li></ol>
      <p>Hiện tại không tự lấy UDID, không tạo profile Apple và không tự đăng ký thiết bị.</p>
    </div>
  </section>;
}
