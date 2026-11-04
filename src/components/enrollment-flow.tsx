"use client";

import { useCallback, useEffect, useState } from "react";

type Phase = "initial" | "starting" | "pending" | "verified" | "reported" | "expired" | "offline" | "error";
type Mode = "provider" | "self" | null;
interface StatusData { status: string; udid?: string; message?: string; error?: string }
interface StartData { status?: string; mode?: string; profileUrl?: string; expiresAt?: string; error?: string }
function stepsFor(mode: Mode) {
  return [
    { number: "01", title: "Tải profile", text: mode === "self"
      ? "Safari tải hồ sơ UDID ngay từ AN IPA STORE, không qua dịch vụ bên ngoài."
      : "Safari tải hồ sơ xác minh từ dịch vụ đã được kiểm tra." },
    { number: "02", title: "Mở Cài đặt", text: "Cho phép tải hồ sơ, vào Cài đặt → Hồ sơ đã tải về, đọc thông tin rồi chọn Cài đặt." },
    { number: "03", title: mode === "self" ? "Thiết bị gửi UDID về" : "Hoàn tất xác minh", text: mode === "self"
      ? "iPhone tự gửi UDID của chính máy về hệ thống. Đây là mức máy tự báo, đang chờ xác minh — chưa phải xác minh danh tính thiết bị."
      : "Thiết bị gửi phản hồi được ký; máy chủ phải kiểm tra chứng thư và mã một lần." },
    { number: "04", title: "Quay lại trang này", text: mode === "self"
      ? "Xem và sao chép UDID ngay khi hệ thống nhận được phản hồi từ máy của bạn."
      : "Xem và sao chép UDID chỉ khi máy chủ xác nhận phản hồi hợp lệ." }
  ];
}
export function EnrollmentFlow() {
  const [phase,setPhase] = useState<Phase>("initial");
  const [mode,setMode] = useState<Mode>(null);
  const [consent,setConsent] = useState(false);
  const [url,setUrl] = useState<string | null>(null);
  const [udid,setUdid] = useState<string | null>(null);
  const [reason,setReason] = useState("");
  const [copied,setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response=await fetch("/api/enrollment/status",{credentials:"same-origin",cache:"no-store"});
      const data:StatusData=await response.json();
      if (!response.ok || data.status === "unavailable") {
        setPhase("offline"); return;
      }
      if (data.status === "verified" && data.udid) {setUdid(data.udid);setPhase("verified");return;}
      if (data.status === "device_reported" && data.udid) {setUdid(data.udid);setMode("self");setPhase("reported");return;}
      if (data.status === "expired") {setPhase("expired");return;}
      if (data.status === "pending") {setPhase("pending");return;}
      setPhase(prev => prev === "pending" ? prev : "initial");
    } catch {setPhase("offline");}
  },[]);
  useEffect(() => { void refresh(); },[refresh]);
  useEffect(() => {
    if (phase !== "pending") return;
    const id=window.setInterval(() => {void refresh();},4000);
    const onVisibility=() => {if (document.visibilityState === "visible") void refresh();};
    document.addEventListener("visibilitychange",onVisibility);
    return () => { window.clearInterval(id);document.removeEventListener("visibilitychange",onVisibility);};
  },[phase,refresh]);

  async function begin() {
    if (!consent || phase === "starting") return;
    setPhase("starting");setReason("");setUrl(null);setUdid(null);
    try {
      const response=await fetch("/api/enrollment/start",{
        method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({consent:true})
      });
      const data:StartData=await response.json();
      if (!response.ok || !data.profileUrl || data.status !== "pending") {
        setReason(response.status===503 ? "Dịch vụ xác minh profile chưa được cấu hình và kiểm thử. Vui lòng dùng hướng dẫn thủ công."
          : response.status===429 ? "Có quá nhiều lượt yêu cầu hoặc dịch vụ tạm thời không khả dụng."
          : "Không tạo được phiên xác minh. Vui lòng kiểm tra lại.");
        setPhase(response.status===503 ? "offline" : "error");return;
      }
      const parsed=new URL(data.profileUrl);
      if (parsed.protocol!=="https:") throw new Error("Invalid profile service URL");
      setMode(data.mode==="self_profile" ? "self" : "provider");
      setUrl(parsed.toString());setPhase("pending");
    } catch {setReason("Không kết nối được đến dịch vụ xác minh.");setPhase("error");}
  }

  async function remove() {
    try {
      const result=await fetch("/api/enrollment/status",{method:"DELETE",credentials:"same-origin"});
      if (!result.ok) throw new Error("Not deleted");
      setUdid(null);setUrl(null);setMode(null);setConsent(false);setCopied(false);setPhase("initial");setReason("");
    } catch {setReason("Không xóa được phiên lúc này. Hãy thử lại hoặc liên hệ hỗ trợ.");}
  }
  async function copy() {
    if (!udid) return;
    try {await navigator.clipboard.writeText(udid);setCopied(true);}
    catch {setReason("Không tự sao chép được. Hãy giữ vào ô UDID rồi chọn Sao chép.");}
  }
  return <div className="enroll-layout">
    <div className="enroll-content">
      <section className="enroll-intro" aria-labelledby="enroll-title">
        <span className="enroll-kicker">AN IPA STORE / DEVICE ENROLLMENT</span>
        <h1 id="enroll-title">Kết nối thiết bị.<br/><span>Gọn gàng, minh bạch.</span></h1>
        <p>Khách không cần tài khoản. Chỉ cung cấp UDID khi bạn đồng ý; chúng tôi không yêu cầu cài LCSign hoặc gửi khóa ký ứng dụng.</p>
        <div className="enroll-trust"><span>✓ Không yêu cầu mật khẩu Apple ID</span><span>✓ Không cài ứng dụng lạ</span><span>✓ Có quyền không tiếp tục</span></div>
      </section>
      <section className="enroll-guide" aria-label="Hướng dẫn cài profile từng bước">
        <h2>4 bước trên Safari iPhone</h2>
        {stepsFor(mode).map(s=><div className="enroll-step" key={s.number}>
          <span className="enroll-step-number">{s.number}</span><div><h3>{s.title}</h3><p>{s.text}</p></div>
        </div>)}
        <p className="enroll-note">Apple yêu cầu người dùng tự xác nhận cài profile trong ứng dụng Cài đặt. Trình duyệt không được phép đọc UDID trực tiếp.</p>
      </section>
    </div>
    <aside className="enroll-panel" aria-label="Bắt đầu xác minh">
      <div className="enroll-device-mark" aria-hidden="true">A</div>
      <p className="enroll-mini">XÁC MINH THIẾT BỊ</p>
      <h2>{phase==="verified"?"Đã xác minh UDID":phase==="reported"?"Đã nhận UDID — chờ xác minh":phase==="pending"?"Đang chờ thiết bị":"Sẵn sàng khi hệ thống được bật"}</h2>
      {phase==="verified" && udid ? <>
        <p className="enroll-note">Phản hồi đã được nhà cung cấp xác minh CMS ký. Chưa đồng nghĩa đã được Apple đưa vào profile Ad Hoc.</p>
        <label htmlFor="verified-udid" className="enroll-label">UDID của bạn</label>
        <input id="verified-udid" className="enroll-result" readOnly value={udid} onFocus={e=>e.target.select()}/>
        <button type="button" className="enroll-primary" onClick={()=>void copy()}>{copied?"Đã sao chép":"Sao chép UDID"}</button>
      </> : phase==="reported" && udid ? <>
        <p className="enroll-note">UDID do máy của bạn gửi về, đang chờ xác minh. Mức này chưa phải xác minh danh tính thiết bị, chưa được Apple đăng ký vào profile và chưa cho phép cài OTA — chủ cửa hàng sẽ đối chiếu trước khi đăng ký máy của bạn.</p>
        <label htmlFor="reported-udid" className="enroll-label">UDID của bạn</label>
        <input id="reported-udid" className="enroll-result" readOnly value={udid} onFocus={e=>e.target.select()}/>
        <button type="button" className="enroll-primary" onClick={()=>void copy()}>{copied?"Đã sao chép":"Sao chép UDID"}</button>
      </> : <>
        <label className="enroll-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>
          <span>Tôi đồng ý gửi UDID cho AN IPA STORE để kiểm tra điều kiện cài ứng dụng, và hiểu rằng UDID không chứng minh quyền cài đặt nếu profile chưa chứa thiết bị.</span></label>
        <button type="button" className="enroll-primary" onClick={()=>void begin()} disabled={!consent || phase==="starting" || phase==="pending"}>
          {phase==="starting"?"Đang tạo phiên…":phase==="pending"?"Đã tạo phiên":"Bắt đầu tải profile"}
        </button>
        {phase==="pending" && url && <a className="enroll-download" href={url}>{mode==="self" ? "Tải profile UDID từ AN IPA STORE" : "Tải profile từ dịch vụ xác minh ↗"}</a>}
        {phase==="pending" && mode==="self" && <p className="enroll-wait" role="status">Cách làm: mở link bằng Safari → chọn Cho phép khi được hỏi tải hồ sơ → mở Cài đặt → Hồ sơ đã tải về → Cài đặt → quay lại trang này. Trạng thái sẽ tự cập nhật khi iPhone gửi UDID về.</p>}
        {phase==="pending" && mode!=="self" && <p className="enroll-wait" role="status">Đang chờ phản hồi đã được xác minh từ iPhone. Quay lại Safari sau khi hoàn tất thao tác trong Cài đặt.</p>}
        {phase==="expired" && <p className="enroll-alert" role="status">Phiên đã hết hạn. Hãy tạo phiên mới nếu vẫn muốn tiếp tục.</p>}
        {(phase==="error" || phase==="offline") && <p className="enroll-alert" role="status">{reason||"Tính năng enrollment chưa sẵn sàng. Không có profile giả được tải về."}</p>}
      </>}

      {(phase==="verified" || phase==="reported" || phase==="pending" || phase==="expired") && <button type="button" className="enroll-remove" onClick={()=>void remove()}>Xóa dữ liệu phiên này</button>}
      {reason && (phase==="verified" || phase==="reported") && <p className="enroll-alert">{reason}</p>}
      <p className="enroll-privacy">Chỉ hiển thị kết quả thật từ server. Ở chế độ tự phát profile, UDID là do máy của bạn gửi về và luôn ghi rõ đang chờ xác minh; mã phiên có thời hạn; không có UDID giả hoặc hoàn thành giả.</p>
    </aside>
  </div>;
}
