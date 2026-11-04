"use client";
import {useState} from "react";
type Check={state:string};
const messages:Record<string,string>={
 PRIVATE_BUCKET_REACHABLE:"Đã kết nối được bucket R2 từ server. Đây chỉ là kiểm tra quyền truy cập, chưa kiểm tra CORS, upload, chữ ký IPA hay OTA.",
 CHECK_NOT_ENABLED:"Chức năng kiểm tra kết nối chưa được bật cho Preview.",
 R2_CONFIG_INCOMPLETE:"Thiếu hoặc sai cấu hình bucket hay khóa R2 trên Vercel.",
 R2_CREDENTIALS_OR_PERMISSIONS:"R2 từ chối: cần kiểm tra quyền token hoặc Access Key ID.",
 R2_BUCKET_NOT_FOUND:"Không tìm thấy bucket. Kiểm tra R2_BUCKET và Account ID.",
 R2_HEAD_FAILED:"Cloudflare R2 trả lỗi khi kiểm tra bucket.",
 R2_NETWORK_OR_SIGNATURE_FAILURE:"Không kết nối được tới R2. Kiểm tra mạng và cấu hình.",
 UNAUTHORIZED:"Phiên Admin hết hạn; vui lòng đăng nhập lại."
};
export function R2ConnectionCheck(){
 const [busy,setBusy]=useState(false),[status,setStatus]=useState("Chưa kiểm tra kết nối R2.");
 async function check(){
  setBusy(true);setStatus("Đang kiểm tra kết nối riêng tư từ máy chủ...");
  try{
   const r=await fetch("/api/admin/storage/health",{cache:"no-store",credentials:"same-origin"});
   const value=await r.json() as Check;
   setStatus(messages[value.state]||"Không thể xác minh kết nối R2.");
  }catch{
   setStatus("Không gọi được API. Kiểm tra mạng hoặc đăng nhập lại.");
  }finally{setBusy(false);}
 }
 return <div className="upload-quarantine">
   <h3>Kiểm tra kết nối Cloudflare R2</h3>
   <p className="small-muted">Kiểm tra riêng tư, chỉ dành cho Admin trên Preview. Không gửi tệp hay lộ khóa R2.</p>
   <button type="button" className="secondary-button" onClick={()=>void check()} disabled={busy}>
     {busy?"Đang kiểm tra…":"Kiểm tra kết nối R2"}
   </button>
   <p role="status" aria-live="polite" className="small-muted">{status}</p>
 </div>;
}
