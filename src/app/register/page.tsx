import Link from "next/link";
import {customerConfig} from "@/modules/auth/customer-server";
import {googleAuthorizeUrl} from "@/modules/auth/customer";
import {CustomerAuthForm} from "@/components/customer-auth-form";
export const dynamic = "force-dynamic";
export default function RegisterPage() {
  const cfg = customerConfig();
  return <section className="reading admin-mobile">
    <Link className="back-link" href="/">← AN IPA STORE</Link>
    <p className="eyebrow">AN IPA STORE / TÀI KHOẢN KHÁCH HÀNG</p>
    <h1>Đăng ký tài khoản.</h1>
    <p className="lead">Một tài khoản cho mọi thiết bị của bạn: UDID đã gửi được gắn vào tài khoản, và bạn có thể nhận lại thiết bị đã gửi trước đó từ chính trình duyệt này sau khi đăng nhập.</p>
    {cfg
      ? <CustomerAuthForm mode="register" googleUrl={googleAuthorizeUrl(cfg)}/>
      : <div className="panel notice" role="status">
          <h2>Tài khoản khách hàng chưa được kích hoạt</h2>
          <p>Cửa hàng chưa bật đăng ký tài khoản. Bạn vẫn xem ứng dụng và gửi UDID như khách vãng lai bình thường.</p>
        </div>}
    <p className="small-muted">Tài khoản chỉ dùng để lưu thiết bị và trạng thái yêu cầu. Cửa hàng không bao giờ yêu cầu mật khẩu Apple ID, mã OTP hay file chứng chỉ của bạn.</p>
  </section>;
}
