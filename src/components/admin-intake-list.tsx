"use client";
import {useCallback,useEffect,useState} from "react";
type Intake={id:string;filename:string;expected_bytes:number;state:string;created_at:string;expires_at:string};
const names:Record<string,string>={
 reserved:"Đã cấp lượt tải — chưa có xác nhận file",
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
    <p className="small-muted">Tạo lúc {new Date(item.created_at).toLocaleString("vi-VN")} · Mã: {item.id.slice(0,8)}</p>
  </article>)}
 </div>;
}
