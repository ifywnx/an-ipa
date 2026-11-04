import Link from "next/link";
import {
  UNCONNECTED_APPLE_QUOTA,
  loadAppleQuotaSummary,
  type AppleQuotaSummary,
} from "@/modules/ota/evidence";
import { createRestOtaDbClient, getOtaServerConfig } from "@/modules/ota/server";

/**
 * Admin UDID page with the Apple registration quota panel.
 *
 * The quota is computed ONLY from device rows recorded in this system as
 * apple_registered (see summarizeAppleQuota). When the server has no
 * database configuration — or the read fails — the panel says plainly
 * "chưa nối dữ liệu Apple" instead of inventing numbers: the true count
 * lives in the owner's Apple Developer account, and this page must never
 * present a guess as that count.
 */
async function loadQuota(): Promise<AppleQuotaSummary> {
  const cfg = getOtaServerConfig();
  if (!cfg) return UNCONNECTED_APPLE_QUOTA;
  try {
    return await loadAppleQuotaSummary(
      createRestOtaDbClient(cfg), new Date().getUTCFullYear());
  } catch {
    return UNCONNECTED_APPLE_QUOTA;
  }
}

export default async function UdidAdminPage() {
  const quota = await loadQuota();
  return <section className="reading admin-mobile">
    <Link className="back-link" href="/admin">← Quay lại Admin</Link>
    <p className="eyebrow">QUẢN LÝ THIẾT BỊ</p><h1>UDID và profile.</h1>
    <p className="lead">Trạng thái yêu cầu là riêng biệt: nhận UDID, xác minh thiết bị, đăng ký với Apple, có trong provisioning profile và đủ điều kiện cài.</p>
    <div className="panel">
      <h2>Hạn mức đăng ký thiết bị Apple (trần 100 / loại / năm)</h2>
      {!quota.connected && <p role="status"><strong>Chưa nối dữ liệu Apple.</strong> Máy chủ chưa có cấu hình cơ sở dữ liệu hoặc không đọc được danh sách thiết bị, nên trang không hiển thị số lượng. Số thật nằm trong tài khoản Apple Developer của chủ cửa hàng — không suy đoán tại đây.</p>}
      {quota.connected && <>
        <p>Năm thành viên đang tính: {quota.membershipYear ?? "—"}. Tổng thiết bị đã ghi nhận đăng ký: {quota.totalRegistered}.</p>
        {quota.classes.length === 0 && <p>Chưa có thiết bị nào được ghi nhận là đã đăng ký với Apple.</p>}
        {quota.classes.length > 0 && <ul>
          {quota.classes.map((c) => <li key={c.deviceClass}>
            <strong>{c.deviceClass}</strong>: đã đăng ký {c.registered}/{c.limit} — còn {c.remaining} chỗ.
          </li>)}
        </ul>}
        <p className="enroll-note">Số liệu tính từ các bản ghi thiết bị trong hệ thống có đánh dấu đã đăng ký Apple. Nếu đăng ký thiết bị ngoài website, phải cập nhật bản ghi tương ứng, nếu không con số này sẽ thấp hơn thực tế phía Apple.</p>
      </>}
    </div>
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
