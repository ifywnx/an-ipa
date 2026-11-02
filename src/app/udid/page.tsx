import type { Metadata } from "next";
import Link from "next/link";
import { EnrollmentFlow } from "@/components/enrollment-flow";
export const metadata:Metadata={title:"Lấy UDID iPhone",description:"Hướng dẫn xác minh UDID iPhone an toàn với sự đồng ý của người dùng."};
export default function UdidPage(){
  return <div className="enroll-shell">
    <div className="enroll-topline"><Link href="/">← AN IPA STORE</Link><span>SAFARI IPHONE</span></div>
    <EnrollmentFlow/>
    <div className="enroll-help"><h2>Nếu không muốn cài profile?</h2>
    <p>Bạn có thể lấy UDID bằng công cụ được Apple hỗ trợ rồi gửi thủ công khi hệ thống đăng ký bảo mật được mở. Nhập thủ công chưa được xem là đã xác minh thiết bị.</p>
    <Link href="/udid/manual">Gửi UDID thủ công →</Link></div>
  </div>;
}
