"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type SavedDevice = {
  requestId?: string;
  status?: string;
  udidSuffix?: string;
};

type AccountDevice = {
  id: string;
  status: string;
  udidSuffix: string;
  deviceLabel: string;
  source: string;
  createdAt: string;
};

const STATUS_LABELS: Record<string, { label: string; note: string }> = {
  pending_unverified: {
    label: "Đã lưu — chờ xác minh",
    note: "UDID đã được lưu cho lần sau. Yêu cầu này chưa được xác minh và chưa đăng ký với Apple, nên chưa đủ điều kiện cài IPA.",
  },
  reviewed_unverified: {
    label: "Đã tiếp nhận — vẫn chờ xác minh",
    note: "Cửa hàng đã xem yêu cầu. Thiết bị vẫn chưa được xác minh và chưa đăng ký với Apple, nên chưa đủ điều kiện cài IPA.",
  },
  rejected: {
    label: "Yêu cầu đã bị từ chối",
    note: "Yêu cầu UDID này không được chấp nhận. Hãy kiểm tra lại UDID và gửi lại, hoặc liên hệ hỗ trợ.",
  },
  verified: {
    label: "Đã xác minh",
    note: "Thiết bị đã xác minh. Việc cài đặt vẫn cần UDID nằm trong provisioning profile của bản IPA và profile còn hiệu lực.",
  },
  expired: {
    label: "Đã hết hạn lưu",
    note: "Yêu cầu lưu UDID đã hết hạn. Hãy gửi lại UDID để tiếp tục.",
  },
  not_started: {
    label: "Chưa có thiết bị nào",
    note: "Trình duyệt này chưa lưu UDID nào.",
  },
};

const SOURCE_LABELS: Record<string, string> = {
  manual_form: "Nhập tay trên web",
  self_profile: "Gửi qua profile UDID",
};

/**
 * Customer device page with two honest scopes:
 * - account devices (GET /api/account/devices): every UDID intake record
 *   owned by the signed-in account, from both intake paths;
 * - browser device (GET /api/devices/manual): the request bound to THIS
 *   browser, which is all there is for guests.
 * Only the last 4 UDID characters are ever shown. Saved records are reused
 * for later orders instead of being re-typed every time.
 */
export default function MyDevices() {
  const [device, setDevice] = useState<SavedDevice | null>(null);
  const [failed, setFailed] = useState(false);
  const [account, setAccount] = useState<"loading" | "off" | "guest" | "user">("loading");
  const [accountDevices, setAccountDevices] = useState<AccountDevice[]>([]);
  useEffect(() => {
    void fetch("/api/devices/manual", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) { setFailed(true); return; }
        setDevice(await r.json() as SavedDevice);
      })
      .catch(() => setFailed(true));
    void fetch("/api/account/session", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 503) { setAccount("off"); return; }
        if (!r.ok) { setAccount("guest"); return; }
        const data: unknown = await r.json().catch(() => null);
        const user = data && typeof data === "object"
          ? (data as { user?: unknown }).user : null;
        if (!user) { setAccount("guest"); return; }
        setAccount("user");
        const list = await fetch("/api/account/devices", { cache: "no-store" });
        if (list.ok) {
          const payload: unknown = await list.json().catch(() => null);
          const devices = payload && typeof payload === "object"
            ? (payload as { devices?: AccountDevice[] }).devices : undefined;
          if (Array.isArray(devices)) setAccountDevices(devices);
        }
      })
      .catch(() => setAccount("guest"));
  }, []);

  const status = device?.status ?? "not_started";
  const info = STATUS_LABELS[status] ?? {
    label: status,
    note: "Trạng thái từ hệ thống tiếp nhận UDID.",
  };

  return <section className="reading">
    <p className="eyebrow">THIẾT BỊ CỦA TÔI</p>
    <h1>Thiết bị đã lưu.</h1>
    <p className="lead">UDID bạn đã gửi được lưu lại để dùng cho các lần cài sau — bạn không phải nhập lại từ đầu. Trang chỉ hiển thị 4 ký tự cuối của UDID.</p>

    {account === "user" && <div className="panel" role="status">
      <h2>Thiết bị của tài khoản</h2>
      {accountDevices.length === 0 && <p>Tài khoản của bạn chưa có thiết bị nào. Hãy gửi UDID (khi đã đăng nhập, thiết bị tự gắn vào tài khoản) hoặc <Link href="/account">nhận thiết bị đã gửi từ trình duyệt này</Link>.</p>}
      {accountDevices.length > 0 && <ul>
        {accountDevices.map((d) => {
          const label = STATUS_LABELS[d.status]?.label ?? d.status;
          return <li key={d.id}>
            <strong>{label}</strong> — UDID ••••{d.udidSuffix}
            {d.deviceLabel ? <> · {d.deviceLabel}</> : null}
            <br/>
            <span className="small-muted">{SOURCE_LABELS[d.source] ?? d.source} · gửi {new Date(d.createdAt).toLocaleDateString("vi-VN")}</span>
          </li>;
        })}
      </ul>}
      <p className="small-muted">Trạng thái “chờ xác minh” nghĩa là UDID chưa được xác minh và chưa đăng ký với Apple — tài khoản không tự làm thiết bị đủ điều kiện cài IPA.</p>
    </div>}

    {account === "guest" && <div className="panel notice" role="status">
      <h2>Đăng ký tài khoản để không mất dấu thiết bị</h2>
      <p>Hiện tại thiết bị của bạn chỉ gắn với <strong>trình duyệt này</strong>: đổi máy, đổi trình duyệt hoặc xóa dữ liệu duyệt web là mất dấu. <Link href="/register">Đăng ký tài khoản</Link> hoặc <Link href="/login">đăng nhập</Link> để lưu thiết bị theo tài khoản và nhận lại thiết bị đã gửi từ trình duyệt này.</p>
    </div>}

    <h2>Thiết bị của trình duyệt này</h2>
    {failed && <div className="panel notice" role="alert">
      <h2>Chưa tải được thông tin thiết bị</h2>
      <p>Dịch vụ tiếp nhận UDID chưa khả dụng hoặc chưa được cấu hình trên website.</p>
    </div>}
    {!failed && device === null && <div className="panel"><p>Đang tải…</p></div>}
    {!failed && device !== null && <div className="panel" role="status">
      <h2>{info.label}</h2>
      <p>{info.note}</p>
      {device.requestId && <p>Mã yêu cầu: <code>{device.requestId}</code></p>}
      {device.udidSuffix && <p>UDID: ••••{device.udidSuffix}</p>}
    </div>}
    <div className="panel">
      <h2>Việc bạn có thể làm</h2>
      <ul>
        <li><Link href="/udid/manual">Gửi hoặc gửi lại UDID</Link> — dùng khi đổi máy hoặc yêu cầu đã hết hạn.</li>
        <li><Link href="/devices/register">Tìm hiểu điều kiện thiết bị</Link> — vì sao cần UDID và các bước đăng ký với Apple.</li>
        <li><Link href="/policies/privacy">Cách cửa hàng xử lý UDID của bạn</Link> — mục đích thu thập, thời gian lưu và cách yêu cầu xóa.</li>
      </ul>
    </div>
  </section>;
}
