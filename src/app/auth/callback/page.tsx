"use client";
import {useEffect, useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";

/**
 * Landing page for Supabase email confirmation, magic links and Google
 * OAuth. Supabase returns the token pair in the URL fragment, which never
 * reaches any server; this page reads it locally and hands it to
 * POST /api/account/session, which verifies it before sealing a cookie.
 * The fragment is cleared from the address bar immediately.
 */
export default function AuthCallbackPage() {
  const [error, setError] = useState("");
  const router = useRouter();
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    window.history.replaceState(null, "", window.location.pathname);
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    const failure = hash.get("error_description") || hash.get("error");
    if (failure || !accessToken || !refreshToken) {
      setError("Liên kết đăng nhập không hợp lệ hoặc đã hết hạn. Hãy đăng nhập lại hoặc yêu cầu liên kết mới.");
      return;
    }
    void fetch("/api/account/session", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({accessToken, refreshToken}),
    }).then(async (response) => {
      if (response.ok) {
        router.replace("/account");
        router.refresh();
        return;
      }
      const data: unknown = await response.json().catch(() => null);
      const message = data && typeof data === "object"
        ? (data as {message?: unknown}).message : undefined;
      setError(typeof message === "string" ? message
        : "Không xác minh được phiên đăng nhập. Hãy thử đăng nhập lại.");
    }).catch(() => setError("Không thể kết nối. Vui lòng kiểm tra mạng và thử lại."));
  }, [router]);

  return <section className="reading admin-mobile">
    <p className="eyebrow">AN IPA STORE / TÀI KHOẢN KHÁCH HÀNG</p>
    <h1>Đang hoàn tất đăng nhập…</h1>
    {error
      ? <div className="panel notice" role="alert">
          <h2>Chưa đăng nhập được</h2>
          <p>{error}</p>
          <p><Link href="/login">Quay lại trang đăng nhập</Link></p>
        </div>
      : <div className="panel" role="status"><p>Đang xác minh phiên đăng nhập của bạn…</p></div>}
  </section>;
}
