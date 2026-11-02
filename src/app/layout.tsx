import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
export const metadata: Metadata = { title: "AN IPA STORE", description: "Phân phối ứng dụng iOS có quyền phát hành hợp lệ" };
export default function Layout({children}: Readonly<{children: React.ReactNode}>) {
 return <html lang="vi"><body><header><Link className="brand" href="/">AN<span>IPA STORE</span></Link><nav aria-label="Điều hướng chính"><Link href="/">Khám phá</Link><Link href="/devices/register">Thiết bị</Link><Link href="/support">Hỗ trợ</Link></nav></header><main>{children}</main><footer>AN IPA STORE · Chỉ phân phối ứng dụng được phép phát hành.<br/>Hệ thống đang được thiết lập. Chưa mở đăng ký hoặc cài đặt.</footer></body></html>;
}
