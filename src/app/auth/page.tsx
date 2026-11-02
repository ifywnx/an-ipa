import Link from "next/link";
export default function AuthPage() { return <section className="reading">
  <p className="eyebrow">TÀI KHOẢN</p><h1>Đăng nhập an toàn.</h1>
  <p className="lead">Hệ thống xác thực đang được tích hợp. Đăng nhập và đăng ký chưa mở để tránh thu nhận tài khoản trước khi chính sách bảo mật và Supabase Auth được cấu hình.</p>
  <div className="panel notice" role="status"><h2>Chưa mở đăng nhập</h2>
  <p>Không nhập mật khẩu hoặc mã xác minh vào biểu mẫu không chính thức. Trang này chưa gửi dữ liệu đăng nhập tới bất kỳ dịch vụ nào.</p>
  <Link href="/support">Thông tin hỗ trợ</Link></div></section>; }
