"use client";
import {useState} from "react";
type Lease={id:string;expiresAt:number;proof:string};
type Prepare={state:string;lease?:Lease;content?:string;uploadUrl?:string;contentType?:string};
type Result={state?:string};
const labels:Record<string,string>={
 BROWSER_CORS_PUT_VERIFIED:"Thành công: trình duyệt gửi PUT lên R2, server đọc đúng từng byte và xóa file mẫu.",
 BROWSER_BYTES_SAVED_BUT_CORS_UNCONFIRMED:"R2 nhận đúng file mẫu và đã xóa, nhưng trình duyệt không xác nhận phản hồi CORS. Cần kiểm tra CORS hoặc chữ ký URL.",
 BROWSER_NOT_UPLOADED:"Không thấy file mẫu trên R2. Có thể preflight CORS hoặc chữ ký PUT đã bị từ chối.",
 BROWSER_CONTENT_MISMATCH:"Nội dung file trên R2 không khớp file mẫu.",
 BROWSER_READ_FORBIDDEN:"Server không được phép đọc lại file mẫu.",
 BROWSER_REMOTE_FAILURE:"Không kết nối/xác minh được file mẫu trên R2.",
 BROWSER_CLEANUP_FAILED:"Không xác nhận được xóa file mẫu. Kiểm tra diagnostics/ trên R2.",
 BROWSER_TEST_DISABLED:"Bài thử upload trình duyệt chưa bật cho Preview.",
 INVALID_ORIGIN:"Bạn đang dùng URL khác APP_ORIGIN của nhánh Preview.",
 UNAUTHORIZED:"Phiên Admin hết hạn. Đăng nhập lại ở URL Preview cố định.",
 INVALID_OR_EXPIRED_LEASE:"Phiên thử upload đã hết hạn. Bấm thử lại.",
 R2_CONFIG_INVALID:"Thiếu cấu hình R2 trên server."
};
export function R2BrowserCheck(){
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState("Chưa kiểm tra upload trực tiếp từ trình duyệt.");
 async function post(input:unknown):Promise<{ok:boolean,data:Prepare & Result}>{
  const r=await fetch("/api/admin/storage/browser-test",{
   method:"POST",credentials:"same-origin",cache:"no-store",
   headers:{"Content-Type":"application/json"},body:JSON.stringify(input)});
  return {ok:r.ok,data:await r.json() as Prepare & Result};
 }
 async function run(){
  if(busy)return;
  setBusy(true);setStatus("Chuẩn bị tệp mẫu và URL upload dùng một lần…");
  try{
   const first=await post({action:"prepare"});
   if(!first.ok||!first.data.lease||!first.data.content||!first.data.uploadUrl){
    setStatus(labels[first.data.state]||"Không thể tạo phép thử CORS.");return;
   }
   setStatus("Đang thử gửi file mẫu từ trình duyệt tới R2…");
   let browserSucceeded=false;
   try{
    const bytes=new TextEncoder().encode(first.data.content);
    const upload=await fetch(first.data.uploadUrl,{
     method:"PUT",mode:"cors",credentials:"omit",
     headers:{"Content-Type":"application/octet-stream"},
     body:bytes
    });
    browserSucceeded=upload.ok;
   }catch{/* The server checks whether bytes persisted, even if CORS blocked JS. */}
   setStatus("Đang xác minh nội dung từ máy chủ và xóa file mẫu…");
   const finish=await post({action:"verify",lease:first.data.lease,browserSucceeded});
   setStatus(labels[finish.data.state]||"Không xác định được kết quả phép thử.");
  }catch{setStatus("Không thể hoàn tất. Kiểm tra kết nối, thời gian phiên Admin hoặc tải lại trang.");}
  finally{setBusy(false);}
 }
 return <div className="upload-quarantine">
  <h3>Thử upload qua Safari / trình duyệt</h3>
  <p className="small-muted">Chỉ gửi một file mẫu nhỏ qua đường CORS và presigned PUT, sau đó server đối chiếu nội dung và xóa. Không gửi IPA thật.</p>
  <button type="button" className="secondary-button" onClick={()=>void run()} disabled={busy}>
   {busy?"Đang thử upload…":"Thử upload mẫu qua trình duyệt"}
  </button>
  <p role="status" aria-live="polite" className="small-muted">{status}</p>
 </div>;
}
