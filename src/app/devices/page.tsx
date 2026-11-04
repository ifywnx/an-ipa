"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type SavedDevice = {
  requestId?: string;
  status?: string;
  udidSuffix?: string;
};

const STATUS_LABELS: Record<string, { label: string; note: string }> = {
  pending_unverified: {
    label: "Đã lưu — chờ xác minh",
    note: "UDID đã được lưu cho lần sau. Yêu cầu này chưa được xác minh và chưa đăng ký với Apple, nên chưa đủ điều kiện cài IPA.",
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

/**
 * Customer device page. Scope honesty: this store has no customer
 * accounts yet, so "your devices" means exactly the manual-UDID request
 * bound to THIS browser (GET /api/devices/manual). The saved UDID is
 * reused for later orders instead of being re-typed every time; only the
 * last 4 characters are ever shown.
 */
export default function MyDevices() {
  const [device, setDevice] = useState<SavedDevice | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void fetch("/api/devices/manual", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) { setFailed(true); return; }
        setDevice(await r.json() as SavedDevice);
      })
      .catch(() => setFailed(true));
  }, []);

  const status = device?.status ?? "not_started";
  const info = STATUS_LABELS[status] ?? {
    label: status,
    note: "Trạng thái từ hệ thống tiếp nhận UDID.",
  };

  return <section className="reading">
    <p className="eyebrow">THIẾT BỊ CỦA TÔI</p>
    <h1>Thiết bị đã lưu.</h1>
    <p className="lead">UDID bạn đã gửi được lưu lại để dùng cho các lần cài sau — bạn không phải nhập lại từ đầu. Hiện tại việc lưu gắn với <strong>trình duyệt này</strong> (cửa hàng chưa có tài khoản khách hàng), và trang chỉ hiển thị 4 ký tự cuối của UDID.</p>
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
