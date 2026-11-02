import Link from "next/link";
export default function Versions(){
 return <section className="reading wide-reading admin-mobile">
  <Link className="back-link" href="/admin/ipa">← IPA từ iPhone</Link>
  <p className="eyebrow">AN IPA STORE / BUILD REGISTRY</p><h1>Ứng dụng & phiên bản.</h1>
  <p className="lead">Theo dõi mỗi ứng dụng theo bundle ID, phiên bản, build, chữ ký và provisioning profile. Khi thay profile trong LCSign, bạn phải tải lên một IPA đã ký mới.</p>
  <div className="panel notice" role="status"><h2>Chưa có phiên bản được xác minh</h2>
   <p>Không hiển thị IPA hay dữ liệu nội bộ cho khách. Phần quản lý thật được mở sau khi xác thực quyền Admin, lưu trữ riêng và worker quét chữ ký hoàn tất.</p></div>
  <div className="admin-modules">
   <article className="panel"><h2>Chờ kiểm tra</h2><p>IPA vừa tải lên chỉ nằm trong vùng quarantine, chưa có quyền cài đặt.</p><span className="badge">Bị khóa mặc định</span></article>
   <article className="panel"><h2>Đã xác minh</h2><p>Cần hash bất biến, chứng thư hợp lệ, profile còn hạn, entitlements và quyền phân phối.</p><span className="badge">Chưa kích hoạt</span></article>
   <article className="panel"><h2>Yêu cầu ký lại</h2><p>Khi cần thêm UDID vào Ad Hoc, chỉnh profile rồi ký lại trên LCSign iPhone.</p><span className="badge">Quy trình thủ công</span></article>
   <article className="panel"><h2>OTA theo thiết bị</h2><p>Chỉ cấp manifest qua HTTPS khi thiết bị đã có trong profile đã xác minh.</p><span className="badge">Chưa cấp phát</span></article>
  </div>
 </section>;
}
