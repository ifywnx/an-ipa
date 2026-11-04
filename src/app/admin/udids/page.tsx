import Link from "next/link";
import {
  UNCONNECTED_APPLE_QUOTA,
  loadAppleQuotaSummary,
  type AppleQuotaSummary,
} from "@/modules/ota/evidence";
import { createRestOtaDbClient, getOtaServerConfig, type OtaServerConfig } from "@/modules/ota/server";
import { enrollmentDb } from "@/modules/enrollment/server";
import { customerConfig } from "@/modules/auth/customer-server";
import { lookupAccountEmail } from "@/modules/accounts/server";
import {
  listAdminUdidQueue, listPendingDeletionRequests,
  type AccountDbClient, type AdminQueueRow, type PendingDeletion,
} from "@/modules/accounts/ownership";

/**
 * Admin UDID page with the Apple registration quota panel.
 *
 * The quota is computed ONLY from device rows recorded in this system as
 * apple_registered (see summarizeAppleQuota). When the server has no
 * database configuration — or the read fails — the panel says plainly
 * "chưa nối dữ liệu Apple" instead of inventing numbers: the true count
 * lives in the owner's Apple Developer account, and this page must never
 * present a guess as that count.
 */
async function loadQuota(): Promise<AppleQuotaSummary> {
  const cfg = getOtaServerConfig();
  if (!cfg) return UNCONNECTED_APPLE_QUOTA;
  try {
    return await loadAppleQuotaSummary(
      createRestOtaDbClient(cfg), new Date().getUTCFullYear());
  } catch {
    return UNCONNECTED_APPLE_QUOTA;
  }
}

function queueClient(cfg: OtaServerConfig): AccountDbClient {
  const base = {supabaseUrl: cfg.supabaseUrl, serviceKey: cfg.serviceKey};
  return {
    async select(path: string): Promise<unknown[]> {
      const rows = await enrollmentDb<unknown>(base, path);
      return Array.isArray(rows) ? rows : [];
    },
    async rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
      return await enrollmentDb<T>(base, "rpc/" + name, {
        method: "POST", body: JSON.stringify(body),
      });
    },
  };
}

interface QueueData {
  rows: AdminQueueRow[];
  deletions: PendingDeletion[];
  emails: Map<string, string | null>;
}

async function loadQueue(): Promise<QueueData | null> {
  const cfg = getOtaServerConfig();
  if (!cfg) return null;
  try {
    const client = queueClient(cfg);
    const [rows, deletions] = await Promise.all([
      listAdminUdidQueue(client),
      listPendingDeletionRequests(client).catch(() => [] as PendingDeletion[]),
    ]);
    // Owner emails are resolved only when customer accounts are configured;
    // without them a row can still show that it belongs to an account.
    const emails = new Map<string, string | null>();
    const accountCfg = customerConfig();
    if (accountCfg) {
      const owners = [...new Set([
        ...rows.map(r => r.userId),
        ...deletions.map(d => d.userId),
      ].filter((v): v is string => !!v))].slice(0, 20);
      for (const userId of owners) {
        emails.set(userId, await lookupAccountEmail(accountCfg, userId));
      }
    }
    return {rows, deletions, emails};
  } catch {
    return null;
  }
}

function ownerLabel(row: AdminQueueRow, emails: Map<string, string | null>): string {
  if (!row.userId) return "Khách vãng lai";
  return emails.get(row.userId) ?? "Tài khoản (chưa đọc được email)";
}

const QUEUE_STATUS: Record<string, string> = {
  pending_unverified: "Chờ xác minh",
  reviewed_unverified: "Đã xem — chờ xác minh",
  rejected: "Đã từ chối",
};

export default async function UdidAdminPage() {
  const quota = await loadQuota();
  const queue = await loadQueue();
  return <section className="reading admin-mobile">
    <Link className="back-link" href="/admin">← Quay lại Admin</Link>
    <p className="eyebrow">QUẢN LÝ THIẾT BỊ</p><h1>UDID và profile.</h1>
    <p className="lead">Trạng thái yêu cầu là riêng biệt: nhận UDID, xác minh thiết bị, đăng ký với Apple, có trong provisioning profile và đủ điều kiện cài.</p>
    <div className="panel">
      <h2>Hạn mức đăng ký thiết bị Apple (trần 100 / loại / năm)</h2>
      {!quota.connected && <p role="status"><strong>Chưa nối dữ liệu Apple.</strong> Máy chủ chưa có cấu hình cơ sở dữ liệu hoặc không đọc được danh sách thiết bị, nên trang không hiển thị số lượng. Số thật nằm trong tài khoản Apple Developer của chủ cửa hàng — không suy đoán tại đây.</p>}
      {quota.connected && <>
        <p>Năm thành viên đang tính: {quota.membershipYear ?? "—"}. Tổng thiết bị đã ghi nhận đăng ký: {quota.totalRegistered}.</p>
        {quota.classes.length === 0 && <p>Chưa có thiết bị nào được ghi nhận là đã đăng ký với Apple.</p>}
        {quota.classes.length > 0 && <ul>
          {quota.classes.map((c) => <li key={c.deviceClass}>
            <strong>{c.deviceClass}</strong>: đã đăng ký {c.registered}/{c.limit} — còn {c.remaining} chỗ.
          </li>)}
        </ul>}
        <p className="enroll-note">Số liệu tính từ các bản ghi thiết bị trong hệ thống có đánh dấu đã đăng ký Apple. Nếu đăng ký thiết bị ngoài website, phải cập nhật bản ghi tương ứng, nếu không con số này sẽ thấp hơn thực tế phía Apple.</p>
      </>}
    </div>
    <div className="panel">
      <h2>Hàng chờ UDID (mới nhất trước)</h2>
      {queue === null && <p role="status"><strong>Chưa đọc được hàng chờ.</strong> Máy chủ chưa có cấu hình cơ sở dữ liệu hoặc đọc thất bại — không hiển thị dữ liệu suy đoán.</p>}
      {queue !== null && queue.rows.length === 0 && <p>Chưa có yêu cầu UDID nào.</p>}
      {queue !== null && queue.rows.length > 0 && <ul>
        {queue.rows.map((row) => <li key={row.id}>
          <strong>{QUEUE_STATUS[row.status] ?? row.status}</strong> — UDID ••••{row.udidSuffix}
          {row.deviceLabel ? <> · {row.deviceLabel}</> : null}
          <br/>
          <span className="small-muted">
            Chủ tài khoản: {ownerLabel(row, queue.emails)} · nguồn: {row.source === "self_profile" ? "Profile UDID" : "Nhập tay"} · gửi {new Date(row.createdAt).toLocaleDateString("vi-VN")}
          </span>
        </li>)}
      </ul>}
      <p className="small-muted">Chỉ hiển thị 4 ký tự cuối của UDID như mọi nơi khác trong hệ thống. “Khách vãng lai” nghĩa là yêu cầu chưa gắn tài khoản nào. Việc có tài khoản không làm yêu cầu được xác minh nhanh hơn và không phải bằng chứng thiết bị.</p>
    </div>
    {queue !== null && queue.deletions.length > 0 && <div className="panel notice">
      <h2>Yêu cầu xóa dữ liệu UDID đang chờ</h2>
      <ul>
        {queue.deletions.map((d) => <li key={d.id}>
          {queue.emails.get(d.userId) ?? "Tài khoản (chưa đọc được email)"} — yêu cầu từ {new Date(d.createdAt).toLocaleDateString("vi-VN")}
        </li>)}
      </ul>
      <p>Xử lý thủ công theo docs/CUSTOMER_ACCOUNTS.md: xóa các bản ghi UDID của tài khoản, rồi đánh dấu yêu cầu là processed trong bảng customer_deletion_requests. Hạn xử lý theo chính sách bảo mật là 30 ngày.</p>
    </div>}
    <div className="panel">
      <h2>Quy trình cập nhật profile</h2>
      <ol><li>Xem yêu cầu chưa xác minh và xin quyền xử lý UDID.</li>
      <li>Xác minh thiết bị rồi thực hiện đăng ký hợp lệ với Apple; duyệt nội bộ không đồng nghĩa Apple đã đăng ký.</li>
      <li>Tạo mới provisioning profile có UDID thiết bị.</li>
      <li>Đưa profile vào LCSign trên iPhone và ký lại từng IPA cần phân phối.</li>
      <li>Upload lại IPA, đợi xác minh profile/chữ ký, rồi mới cấp link OTA.</li></ol>
      <p>Hiện tại không tự lấy UDID, không tạo profile Apple và không tự đăng ký thiết bị.</p>
    </div>
  </section>;
}
