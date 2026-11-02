"use client";
import {useEffect,useRef,useState} from "react";
import {MAX_DIRECT_IPA_BYTES} from "@/modules/ipa/r2-presign";
type Grant={uploadUrl?:string;headers?:Record<string,string>;error?:string};
export function PrivateIpaUpload({file}:{file:File|null}){
 const [busy,setBusy]=useState(false),[progress,setProgress]=useState(0);
 const [status,setStatus]=useState("");
 const active=useRef<XMLHttpRequest|null>(null);
 useEffect(()=>()=>{active.current?.abort();},[]);
 async function send(){
  if(!file||busy||file.size>MAX_DIRECT_IPA_BYTES)return;
  setBusy(true);setProgress(0);setStatus("Đang yêu cầu cấp quyền upload riêng tư…");
  try{
   const response=await fetch("/api/admin/uploads/prepare",{
    method:"POST",cache:"no-store",credentials:"same-origin",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({filename:file.name,size:file.size})
   });
   const grant=await response.json() as Grant;
   if(!response.ok||!grant.uploadUrl||!grant.headers){
    setStatus(response.status===503
      ?"Upload riêng tư chưa được kích hoạt. Cần cấu hình kho R2, WAF và worker quét IPA."
      :response.status===401?"Phiên Admin hết hạn. Hãy đăng nhập lại."
      :"Không cấp được quyền upload. Vui lòng thử lại.");
    setBusy(false);return;
   }
   await new Promise<void>((resolve,reject)=>{
    const xhr=new XMLHttpRequest();
    active.current=xhr;
    xhr.open("PUT",grant.uploadUrl as string,true);
    xhr.timeout=10*60*1000;
    xhr.setRequestHeader("Content-Type","application/octet-stream");
    xhr.upload.onprogress=e=>{if(e.lengthComputable)setProgress(Math.floor(e.loaded/e.total*100));};
    xhr.onerror=()=>reject(new Error("network"));
    xhr.ontimeout=()=>reject(new Error("timeout"));
    xhr.onabort=()=>reject(new Error("cancelled"));
    xhr.onload=()=>{
      if(xhr.status>=200&&xhr.status<300)resolve();
      else reject(new Error("upload_rejected"));
    };
    xhr.send(file);
   });
   setProgress(100);
   setStatus("R2 đã tiếp nhận file vào vùng cách ly. Chưa kiểm tra chữ ký, chưa xuất bản hay cho phép cài OTA.");
  }catch{
   setStatus("Không upload thành công. Có thể do mạng, CORS, thời hạn URL hoặc file không đúng dung lượng đã ký.");
  }finally{active.current=null;setBusy(false);}
 }
 function cancel(){active.current?.abort();}
 return <div className="upload-quarantine">
   <h3>Kho IPA riêng tư (thử nghiệm)</h3>
   <p className="small-muted">Chỉ tải được khi hệ thống WAF, R2 và worker quét thật đã sẵn sàng. Một lượt tối đa 100 MiB; file lớn cần upload multipart trong giai đoạn sau.</p>
   <button className="button" type="button" onClick={()=>void send()}
     disabled={!file||busy||file.size>MAX_DIRECT_IPA_BYTES}>
     {busy?"Đang tải lên…":"Upload IPA đã ký vào kho cách ly"}
   </button>
   {busy&&<button className="secondary-button" type="button" onClick={cancel}>Hủy upload</button>}
   {busy&&<progress aria-label="Tiến độ upload IPA" value={progress} max={100}/>}
   {file&&file.size>MAX_DIRECT_IPA_BYTES&&
     <p className="enroll-alert">File lớn hơn 100 MiB. Chưa hỗ trợ upload trực tiếp ở bản thử nghiệm này.</p>}
   {status&&<p role="status" className="small-muted">{status}</p>}
 </div>;
}
