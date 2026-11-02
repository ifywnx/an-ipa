import Link from "next/link";
const areas = [
  {name:"Tổng quan",desc:"Báo cáo hoạt động và kiểm soát trạng thái",ready:false},
  {name:"Ứng dụng",desc:"Quản lý ứng dụng, nhà phát triển và phê duyệt",ready:false},
  {name:"Thiết bị",desc:"Đăng ký, xác minh, thu hồi quyền",ready:false},
  {name:"Phân phối",desc:"Kênh IPA, profile và quyền cài đặt",ready:false},
  {name:"Nhật ký",desc:"Truy vết hành động quản trị có kiểm soát",ready:false},
];
export default function Admin() { return <section className="reading wide-reading">
  <p className="eyebrow">ADMIN WORKSPACE</p><h1>Quản trị ứng dụng.</h1>
  <div className="panel notice" role="status"><h2>Quản trị chưa được kích hoạt</h2><p>Không có dữ liệu quản trị được tải xuống trình duyệt. Cần xác thực phiên, phân quyền server-side và kiểm thử RLS trước khi bật bất kỳ chức năng nào.</p>
  <Link href="/auth">Tài khoản</Link></div>
  <div className="admin-modules">{areas.map(a => <article className="panel" key={a.name}><p className="eyebrow">CHƯA CẤU HÌNH</p><h2>{a.name}</h2><p>{a.desc}</p><span className="badge">Đang phát triển</span></article>)}</div>
</section>; }
