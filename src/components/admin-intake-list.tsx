"use client";
import {useCallback,useEffect,useState} from "react";
type ScanSummary={bundle_id?:string;version?:string;build?:string;profile_type?:string;ad_hoc_device_count?:number};
type Intake={id:string;filename:string;expected_bytes:number;state:string;created_at:string;expires_at:string;scan_finished_at?:string|null;scan_error?:string|null;scan_report?:ScanSummary|null;scan_attempts?:number;delete_after?:string;object_deleted_at?:string|null;cleanup_error?:string|null;sha256_verified?:string|null};
const names:Record<string,string>={
 reserved:"Đã cấp lượt tải — chưa có xác nhận file",
 uploaded_pending_scan:"Trình duyệt báo tải xong — chờ worker xác minh file",
 scanning:"Worker đang quét trong kho cách ly",
 quarantined_unverified:"Trong kho cách ly — chưa được xác minh",
 rejected:"Bị từ chối",
 verified_internal:"Đã qua kiểm tra nội bộ — chưa được cấp OTA"
};
export function AdminIntakeList(){
 const [items,setItems]=useState<Intake[]>([]);
 const [busy,setBusy]=useState(true);
 const [message,setMessage]=useState("");
 const load=useCallback(async()=>{
  setBusy(true);setMessage("");
  try{
   const r=await fetch("/api/admin/uploads/intakes",{credentials:"same-origin",cache:"no-store"});
   if(!r.ok){setMessage(r.status===401?"Phiên Admin hết hạn. Vui lòng đăng nhập lại.":"Không thể tải lịch sử tiếp nhận.");return;}
   const data=await r.json() as {items?:Intake[]};
   if(!Array.isArray(data.items)){setMessage("Lịch sử chưa khả dụng.");return;}
   setItems(data.items);
  }catch{setMessage("Không kết nối được tới dữ liệu tiếp nhận IPA.");}
  finally{setBusy(false);}
 },[]);
 useEffect(()=>{void load();},[load]);
 async function resume(id:string){
  setBusy(true);
  try{const r=await fetch('/api/admin/worker',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'retry',receiptId:id})});setMessage(r.ok?'Đã kiểm tra lịch xử lý. Worker vẫn áp dụng giới hạn số lần thử.':'Không thể tiếp tục xử lý.');}catch{setMessage('Không kết nối được tới worker.');}finally{setBusy(false);}
 }
 return <div className="panel">
  <div className="section-title">
   <h2>Phiên tiếp nhận IPA riêng tư</h2>
   <button type="button" className="secondary-button" disabled={busy} onClick={()=>void load()}>
    {busy?"Đang tải…":"Làm mới"}
   </button>
  </div>
  <p className="small-muted">Bản ghi chỉ dành cho Admin. Trạng thái “đã cấp lượt tải” không chứng minh file đã tới R2. Không có phiên bản nào tự được phép cài OTA.</p>
  {message&&<p role="status">{message}</p>}
  {!busy&&!message&&items.length===0&&<p role="status">Chưa có lượt tiếp nhận IPA nào.</p>}
  {items.map(item=><article className="intake-item" key={item.id}>
    <strong>{item.filename}</strong>
    <p>{(item.expected_bytes/1048576).toFixed(1)} MiB · {names[item.state]||"Trạng thái đang kiểm tra"}</p>
    {item.scan_report?.bundle_id&&<p className="small-muted">Bundle: {item.scan_report.bundle_id} · v{item.scan_report.version||"?"} ({item.scan_report.build||"?"}) · Profile: {item.scan_report.profile_type||"chưa rõ"}</p>}
    {item.scan_error&&<p className="small-muted">Mã kiểm tra: {item.scan_error}</p>}
    {item.sha256_verified&&<p className="small-muted">SHA-256: {item.sha256_verified.slice(0,16)}… · Chỉ kiểm tra dữ liệu, không xác thực Apple</p>}
    <p className="small-muted">Lượt quét: {item.scan_attempts||0}/3 · Chữ ký Apple: chưa xác minh · OTA: chưa cấp phép</p>
    {item.object_deleted_at?<p className="small-muted">Đã xóa file khỏi kho cách ly.</p>:item.delete_after&&<p className="small-muted">Hạn lưu file: {new Date(item.delete_after).toLocaleString("vi-VN")}{item.cleanup_error?' · Xóa file cần kiểm tra: '+item.cleanup_error:''}</p>}
    {item.state==='uploaded_pending_scan'&&<button className="secondary-button" disabled={busy} onClick={()=>void resume(item.id)}>Tiếp tục xử lý</button>}
    <p className="small-muted">Tạo lúc {new Date(item.created_at).toLocaleString("vi-VN")} · Mã: {item.id.slice(0,8)}</p>
  </article>)}
 </div>;
}
