import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: { default: "AN IPA STORE", template: "%s · AN IPA STORE" }, description: "Danh mục ứng dụng iOS với điều kiện phân phối minh bạch." };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body><header className="site-header">
    <Link className="brand" href="/" aria-label="AN IPA STORE, trang chủ">AN<span>IPA STORE</span></Link>
    <nav aria-label="Điều hướng chính"><Link href="/apps">Ứng dụng</Link><Link href="/udid">Lấy UDID</Link><Link href="/devices/register">Thiết bị</Link><Link href="/support">Hỗ trợ</Link><Link href="/auth">Admin</Link></nav>
  </header><main id="main-content">{children}</main><footer>AN IPA STORE · Chỉ phân phối ứng dụng được phép phát hành.<br/>Hệ thống đang hoàn thiện. Chưa mở tải IPA hoặc đăng ký thiết bị thật.</footer></body></html>;
}
