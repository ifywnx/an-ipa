"use client";
import Link from "next/link";
import { useState, type ChangeEvent } from "react";
import {PrivateIpaUpload} from "@/components/private-ipa-upload";
import {R2ConnectionCheck} from "@/components/r2-connection-check";
import {R2WriteCheck} from "@/components/r2-write-check";
import { preflightIpa, type IpaPreflight, MAX_IPA_BYTES } from "@/modules/ipa/preflight";

export default function SignedIpaPage() {
  const [info, setInfo] = useState<{ name: string; size: number; check: IpaPreflight } | null>(null);
  const [reading, setReading] = useState(false);
  const [selectedFile,setSelectedFile] = useState<File|null>(null);
  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const f = event.currentTarget.files?.[0];
    setInfo(null);
    setSelectedFile(null);
    if (!f) return;
    setReading(true);
    try {
      // Read FOUR bytes only; even large IPA files stay on the iPhone in this stage.
      const head = new Uint8Array(await f.slice(0, 4).arrayBuffer());
      const check = preflightIpa(f.name, f.size, head);
      setInfo({ name: f.name, size: f.size, check });
      if(check.ok)setSelectedFile(f);
    } catch {
      setInfo({ name: f.name, size: f.size, check: { ok: false, detail: "Không đọc được header tệp." } });
    } finally { setReading(false); }
  }
  return <section className="reading wide-reading admin-mobile">
    <Link href="/admin" className="back-link">← Quay lại Admin</Link>
    <p className="eyebrow">LCSign · iPhone workflow</p>
    <h1>IPA đã ký.</h1>
    <p className="lead">Ký bằng LCSign trên iPhone của bạn, lưu IPA đã ký vào ứng dụng Tệp, rồi chọn file tại đây. Bạn bè không cần cài LCSign.</p>
    <div className="panel">
      <h2>Chọn IPA từ iPhone</h2>
      <label className="upload-label" htmlFor="signed-ipa-file">Chọn từ ứng dụng Tệp (.ipa)</label>
      <input id="signed-ipa-file" type="file" accept=".ipa,application/octet-stream" onChange={onFile} aria-describedby="upload-stage-info" />
      <p id="upload-stage-info" className="small-muted">Chỉ kiểm tra cục bộ bốn byte đầu và dung lượng. Giới hạn dự kiến {Math.round(MAX_IPA_BYTES / (1024 * 1024))} MiB.</p>
      {reading && <p role="status">Đang đọc thông tin tệp trên iPhone…</p>}
      {info && <div className="preflight-result" role="status">
        <strong>{info.name}</strong>
        <p>{(info.size/(1024*1024)).toFixed(1)} MiB · {info.check.ok ? "Đạt kiểm tra sơ bộ" : "Không đạt kiểm tra sơ bộ"}</p>
        <p>{info.check.detail}</p>
      </div>}
      <R2ConnectionCheck/>
      <R2WriteCheck/>
      <PrivateIpaUpload file={selectedFile}/>
      <div className="notice-inline" role="note"><strong>Chưa mở upload cho người dùng thật.</strong>
      <p>Upload vào R2 vẫn bị khóa mặc định. Khi có đầy đủ hạ tầng, tệp chỉ vào vùng cách ly; kiểm tra ZIP, chữ ký và provisioning profile phải hoàn tất mới có thể xét xuất bản. Không gửi P12 hoặc private key.</p></div>
    </div>
    <div className="panel">
      <h2>Khi thêm UDID mới</h2>
      <ol><li>Đăng ký thiết bị hợp lệ trên Apple Developer / nhà cung cấp chứng chỉ được ủy quyền.</li>
      <li>Tạo/cập nhật provisioning profile chứa thiết bị.</li>
      <li>Nhập profile mới vào LCSign trên iPhone, ký lại IPA.</li>
      <li>Upload bản IPA đã ký mới và đợi kiểm tra hoàn chỉnh trước khi phát hành.</li></ol>
    </div>
    <p><Link href="/admin/ipa/versions">Quản lý ứng dụng và phiên bản →</Link></p><p><Link href="/admin/udids">Xem quy trình quản lý UDID →</Link></p>
  </section>;
}
