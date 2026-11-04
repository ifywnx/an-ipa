"use client";
import {useCallback, useEffect, useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";

interface AccountUser { id: string; email: string }
interface PendingDeletion { id: string; createdAt: string }

export function AccountPanel() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/account/session", {cache: "no-store"});
      if (response.status === 503) { setDisabled(true); setLoaded(true); return; }
      const data: unknown = await response.json().catch(() => null);
      const account = data && typeof data === "object"
        ? (data as {user?: AccountUser | null}).user ?? null : null;
      setUser(account);
      if (account) {
        const deletion = await fetch("/api/account/deletion-request", {cache: "no-store"});
        if (deletion.ok) {
          const dData: unknown = await deletion.json().catch(() => null);
          setPendingDeletion(dData && typeof dData === "object"
            ? (dData as {pending?: PendingDeletion | null}).pending ?? null : null);
        }
      }
    } catch { /* panels below explain the states */ }
    setLoaded(true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function claim() {
    if (busy) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/account/claim", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: {"Content-Type": "application/json"}, body: "{}",
      });
      const data: unknown = await response.json().catch(() => null);
      const message = data && typeof data === "object"
        ? (data as {message?: unknown}).message : undefined;
      setNotice(typeof message === "string" ? message : "Không nhận được thiết bị nào.");
    } catch { setNotice("Không thể kết nối. Vui lòng thử lại."); }
    finally { setBusy(false); }
  }

  async function requestDeletion() {
    if (busy) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/account/deletion-request", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: {"Content-Type": "application/json"}, body: "{}",
      });
      const data: unknown = await response.json().catch(() => null);
      const message = data && typeof data === "object"
        ? (data as {message?: unknown}).message : undefined;
      if (response.ok) {
        setPendingDeletion({id: "pending", createdAt: new Date().toISOString()});
        setNotice(typeof message === "string" ? message : "Đã ghi nhận yêu cầu xóa dữ liệu UDID.");
      } else {
        setNotice(typeof message === "string" ? message : "Không gửi được yêu cầu. Hãy thử lại sau.");
      }
    } catch { setNotice("Không thể kết nối. Vui lòng thử lại."); }
    finally { setBusy(false); }
  }

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/account/logout", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: {"Content-Type": "application/json"}, body: "{}",
      });
    } catch { /* cookie may already be gone */ }
    router.replace("/");
    router.refresh();
  }

  if (!loaded) return <div className="panel"><p>Đang tải…</p></div>;
  if (disabled) return <div className="panel notice" role="status">
    <h2>Tài khoản khách hàng chưa được kích hoạt</h2>
    <p>Cửa hàng chưa bật tài khoản khách hàng trên website này.</p>
  </div>;
  if (!user) return <div className="panel notice" role="status">
    <h2>Bạn chưa đăng nhập</h2>
    <p><Link href="/login">Đăng nhập</Link> hoặc <Link href="/register">đăng ký tài khoản</Link> để quản lý thiết bị theo tài khoản.</p>
  </div>;

  return <>
    <div className="panel">
      <h2>{user.email}</h2>
      <p>Đây là tài khoản khách hàng của bạn. UDID và thiết bị bạn gửi khi đã đăng nhập được tự động gắn vào tài khoản này.</p>
      <p><Link href="/devices">Xem thiết bị của tôi</Link></p>
      <button type="button" className="button" disabled={busy} onClick={() => void logout()}>
        Đăng xuất
      </button>
    </div>
    <div className="panel">
      <h2>Nhận thiết bị đã gửi từ trình duyệt này</h2>
      <p>Nếu trước đây bạn từng gửi UDID trên chính trình duyệt này khi chưa đăng nhập, hãy nhận các thiết bị đó về tài khoản. Việc nhận chỉ dựa trên phiên trình duyệt đã gửi — không thể nhận thiết bị của người khác.</p>
      <button type="button" className="button" disabled={busy} onClick={() => void claim()}>
        Nhận thiết bị của trình duyệt này
      </button>
    </div>
    <div className="panel">
      <h2>Xóa dữ liệu UDID</h2>
      {pendingDeletion
        ? <p role="status">Bạn đã yêu cầu xóa dữ liệu UDID vào {new Date(pendingDeletion.createdAt).toLocaleDateString("vi-VN")}. Cửa hàng xử lý trong vòng 30 ngày theo <Link href="/policies/privacy">chính sách bảo mật</Link> và xác nhận khi hoàn tất. Sau khi xóa, thiết bị sẽ không còn đủ điều kiện cài các bản IPA mới.</p>
        : <>
          <p>Bạn có thể yêu cầu xóa UDID và dữ liệu liên quan bất cứ lúc nào, đúng như <Link href="/policies/privacy">chính sách bảo mật</Link> đã nêu. Cửa hàng xử lý trong vòng 30 ngày.</p>
          <button type="button" className="button" disabled={busy} onClick={() => void requestDeletion()}>
            Yêu cầu xóa dữ liệu UDID của tôi
          </button>
        </>}
    </div>
    {notice && <p role="status" className="panel">{notice}</p>}
  </>;
}
