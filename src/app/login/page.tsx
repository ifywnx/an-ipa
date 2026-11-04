import Link from "next/link";
import {customerConfig} from "@/modules/auth/customer-server";
import {googleAuthorizeUrl} from "@/modules/auth/customer";
import {CustomerAuthForm} from "@/components/customer-auth-form";
export const dynamic = "force-dynamic";
export default function LoginPage() {
  const cfg = customerConfig();
  return <section className="reading admin-mobile">
    <Link className="back-link" href="/">← AN IPA STORE</Link>
    <p className="eyebrow">AN IPA STORE / TÀI KHOẢN KHÁCH HÀNG</p>
    <h1>Đăng nhập.</h1>
    <p className="lead">Đăng nhập để UDID và thiết bị bạn gửi được lưu theo tài khoản — đổi trình duyệt hay đổi máy vẫn xem lại được trạng thái, không mất dấu thiết bị.</p>
    {cfg
      ? <CustomerAuthForm mode="login" googleUrl={googleAuthorizeUrl(cfg)}/>
      : <div className="panel notice" role="status">
          <h2>Tài khoản khách hàng chưa được kích hoạt</h2>
          <p>Cửa hàng chưa bật đăng ký tài khoản. Bạn vẫn xem ứng dụng và gửi UDID như khách vãng lai bình thường.</p>
        </div>}
  </section>;
}
