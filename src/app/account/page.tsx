import Link from "next/link";
import {AccountPanel} from "@/components/account-panel";
export const dynamic = "force-dynamic";
export default function AccountPage() {
  return <section className="reading admin-mobile">
    <Link className="back-link" href="/">← AN IPA STORE</Link>
    <p className="eyebrow">AN IPA STORE / TÀI KHOẢN KHÁCH HÀNG</p>
    <h1>Tài khoản của tôi.</h1>
    <AccountPanel/>
  </section>;
}
