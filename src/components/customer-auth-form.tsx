"use client";
import {useState, type FormEvent} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";

interface Props {
  mode: "login" | "register";
  googleUrl: string | null;
}

export function CustomerAuthForm({mode, googleUrl}: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [done, setDone] = useState("");
  const router = useRouter();
  const isLogin = mode === "login";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setNotice(""); setDone("");
    try {
      const response = await fetch(isLogin ? "/api/account/login" : "/api/account/register", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({email: email.trim(), password}),
      });
      setPassword("");
      const data: unknown = await response.json().catch(() => null);
      const message = data && typeof data === "object"
        ? (data as {message?: unknown}).message : undefined;
      if (response.ok && data && typeof data === "object"
        && (data as {confirmed?: unknown}).confirmed === false) {
        setDone(typeof message === "string" ? message
          : "Đã tạo tài khoản. Hãy mở email và bấm liên kết xác thực, sau đó đăng nhập.");
        return;
      }
      if (response.ok) {
        router.replace("/account");
        router.refresh();
        return;
      }
      setNotice(typeof message === "string" ? message : isLogin
        ? "Email hoặc mật khẩu chưa chính xác, hoặc email chưa được xác thực."
        : "Không tạo được tài khoản. Email có thể đã được đăng ký.");
    } catch {
      setNotice("Không thể kết nối. Vui lòng kiểm tra mạng và thử lại.");
    } finally { setBusy(false); }
  }

  async function magicLink() {
    if (busy || !email.trim()) {
      setNotice("Hãy nhập email trước khi dùng liên kết đăng nhập.");
      return;
    }
    setBusy(true); setNotice(""); setDone("");
    try {
      const response = await fetch("/api/account/magic-link", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({email: email.trim()}),
      });
      const data: unknown = await response.json().catch(() => null);
      const message = data && typeof data === "object"
        ? (data as {message?: unknown}).message : undefined;
      if (response.ok) {
        setDone(typeof message === "string" ? message
          : "Nếu email hợp lệ, liên kết đăng nhập đã được gửi.");
      } else {
        setNotice(typeof message === "string" ? message : "Không gửi được liên kết. Hãy thử lại sau.");
      }
    } catch {
      setNotice("Không thể kết nối. Vui lòng kiểm tra mạng và thử lại.");
    } finally { setBusy(false); }
  }

  return <div className="panel admin-auth-form">
    <form onSubmit={e => void submit(e)}>
      <label htmlFor="customer-email">Email</label>
      <input id="customer-email" type="email" autoComplete="username" required maxLength={254}
        value={email} onChange={e => setEmail(e.target.value)} placeholder="email@vi-du.com"/>
      <label htmlFor="customer-password">Mật khẩu</label>
      <input id="customer-password" type="password"
        autoComplete={isLogin ? "current-password" : "new-password"}
        required minLength={8} maxLength={256}
        value={password} onChange={e => setPassword(e.target.value)}
        placeholder={isLogin ? "Mật khẩu của bạn" : "Tối thiểu 8 ký tự"}/>
      <button type="submit" className="button admin-auth-submit" disabled={busy}>
        {busy ? "Đang xử lý…" : isLogin ? "Đăng nhập" : "Tạo tài khoản"}
      </button>
    </form>
    {isLogin && <button type="button" className="button" disabled={busy} onClick={() => void magicLink()}>
      Gửi liên kết đăng nhập qua email (không cần mật khẩu)
    </button>}
    {googleUrl && <p><a className="button" href={googleUrl}>Tiếp tục với Google</a></p>}
    {notice && <p role="alert" className="enroll-alert">{notice}</p>}
    {done && <p role="status">{done}</p>}
    <p className="small-muted">
      {isLogin
        ? <>Chưa có tài khoản? <Link href="/register">Đăng ký</Link>. Đây là tài khoản khách hàng — hoàn toàn tách biệt với <Link href="/auth">đăng nhập Admin</Link>.</>
        : <>Đã có tài khoản? <Link href="/login">Đăng nhập</Link>. Sau khi đăng ký, hãy mở email và bấm liên kết xác thực trước khi đăng nhập.</>}
    </p>
  </div>;
}
