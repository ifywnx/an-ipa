import Link from "next/link";
import {adminConfig} from "@/modules/auth/admin-server";
import {AdminLoginForm} from "@/components/admin-login-form";
export const dynamic="force-dynamic";
export default function AuthPage(){
 const available=!!adminConfig();
 return <section className="reading admin-mobile">
   <Link className="back-link" href="/">← AN IPA STORE</Link>
   <p className="eyebrow">AN IPA STORE / KHU VỰC QUẢN TRỊ</p>
   <h1>Đăng nhập Admin.</h1>
   <p className="lead">Khách hàng không cần tài khoản để xem ứng dụng hay đăng ký thiết bị. Chỉ người quản trị mới dùng trang này.</p>
   {available?<AdminLoginForm/>:<div className="panel notice" role="status">
     <h2>Đăng nhập chưa được kích hoạt</h2>
     <p>Để tránh thu mật khẩu trước khi bảo vệ server và WAF sẵn sàng, hệ thống hiện không nhận đăng nhập.</p>
   </div>}
   <p className="small-muted">Không chia sẻ P12, private key hoặc mật khẩu chứng chỉ LCSign tại đây.</p>
 </section>;
}
