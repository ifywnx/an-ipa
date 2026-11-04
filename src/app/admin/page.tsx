import Link from "next/link";
import {AdminLogout} from "@/components/admin-logout";
const areas = [
  {name:"Ứng dụng", desc:"Tạo bản nháp, chỉnh sửa danh mục và xem nhật ký", href:"/admin/apps"},
  {name:"IPA đã ký", desc:"Chọn IPA từ iPhone, kiểm tra sơ bộ, theo dõi quy trình ký lại", href:"/admin/ipa"},
  {name:"Thiết bị & UDID",desc:"Theo dõi trạng thái, hướng dẫn bổ sung provisioning profile",href:"/admin/udids"},
];
export default function Admin() { return <section className="reading wide-reading admin-mobile">
  <div className="admin-topline"><p className="eyebrow">AN IPA STORE · MOBILE ADMIN</p><AdminLogout/></div><h1>Điều hành trên iPhone.</h1>
  <p className="lead">Ký bằng LCSign trên iPhone. Website không yêu cầu P12/private key và không ký IPA.</p>
  <div className="panel notice" role="status"><h2>Đã xác minh quyền Admin</h2>
    <p>Bạn đã đăng nhập và được kiểm tra quyền Admin tại máy chủ. Upload IPA thật và cấp quyền OTA vẫn khóa cho đến khi tích hợp kho lưu trữ và xác minh chữ ký.</p></div>
  <div className="admin-modules">
    {areas.map(a => <article className="panel" key={a.href}><h2>{a.name}</h2><p>{a.desc}</p><Link className="secondary-button" href={a.href}>Mở quản lý</Link></article>)}
  </div>
  <div className="panel"><h2>Quy trình phát hành</h2><ol><li>Ký IPA trong LCSign trên iPhone.</li><li>Upload riêng tư lên website khi chức năng bảo mật được bật.</li><li>Quét ZIP, xác minh chữ ký và provisioning profile.</li><li>Xuất bản phiên bản đủ điều kiện, cấp OTA theo từng thiết bị.</li></ol></div>
</section>; }
