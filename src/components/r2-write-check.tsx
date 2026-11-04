"use client";
import {useState} from "react";
type Result={state?:string};
const message:Record<string,string>={
 R2_WRITE_TEST_OK:"Đã ghi, xác minh HEAD, đọc đối chiếu từng byte bằng GET và xóa file mẫu thành công. Chưa thử upload IPA từ Safari.",
 R2_WRITE_READ_OK_HEAD_INCONCLUSIVE:"Đã ghi, đọc đúng toàn bộ nội dung file mẫu bằng GET và xóa thành công. Chỉ kiểm tra metadata HEAD chưa xác nhận được; không ảnh hưởng kết quả đối chiếu nội dung.",
 R2_CONTENT_MISMATCH:"File đọc lại khác nội dung đã ghi hoặc vượt giới hạn 256 byte. Không thể xác nhận tính toàn vẹn.",
 R2_GET_PERMISSION_DENIED:"Ghi thành công nhưng Cloudflare từ chối đọc file qua GET. Kiểm tra quyền Object Read.",
 R2_GET_NOT_FOUND:"Ghi được nhưng không tìm thấy file mẫu khi đọc lại.",
 R2_GET_FAILED:"Ghi thành công nhưng GET không trả dữ liệu hợp lệ.",
 R2_WRITE_PERMISSION_DENIED:"Cloudflare R2 từ chối quyền ghi. Hãy kiểm tra API token có Object Read & Write.",
 R2_WRITE_REJECTED:"R2 không chấp nhận ghi tệp thử nghiệm.",
 R2_VERIFY_FAILED:"Đã gửi tệp mẫu nhưng không xác minh được bằng HEAD Object.",
 R2_WRITE_NETWORK_ERROR:"Kết nối tới R2 bị lỗi trong lúc ghi hoặc kiểm tra.",
 R2_CLEANUP_FAILED:"Không xác nhận được việc xóa file kiểm tra. Cần kiểm tra các tệp trong thư mục diagnostics/ trước khi thử lại.",
 STORAGE_CONFIG_INVALID:"Cấu hình R2 chưa hoàn chỉnh.",
 WRITE_TEST_DISABLED:"Kiểm tra quyền ghi R2 chưa được bật cho Preview.",
 INVALID_ORIGIN:"Đường dẫn Preview không trùng cấu hình APP_ORIGIN.",
 UNAUTHORIZED:"Phiên Admin đã hết hạn. Bạn cần đăng nhập lại."
};
export function R2WriteCheck(){
 const [loading,setLoading]=useState(false),[text,setText]=useState("Chưa thử quyền ghi và xóa tệp mẫu.");
 async function run(){
  if(loading)return;
  setLoading(true);setText("Đang kiểm tra quyền ghi, kiểm tra kích thước và xóa tệp mẫu…");
  try{
   const response=await fetch("/api/admin/storage/write-test",{
    method:"POST",cache:"no-store",credentials:"same-origin"
   });
   const data=await response.json() as Result;
   setText(message[data.state||""]||"Không xác minh được quyền ghi R2.");
  }catch{setText("Không gọi được API. Kiểm tra kết nối hoặc thử đăng nhập lại.");}
  finally{setLoading(false);}
 }
 return <div className="upload-quarantine">
   <h3>Thử ghi và xóa file mẫu</h3>
   <p className="small-muted">Chỉ tạo tệp văn bản thử nghiệm nhỏ ở diagnostics/, không lấy tệp IPA và không công khai dữ liệu.</p>
   <button type="button" className="secondary-button" disabled={loading} onClick={()=>void run()}>
    {loading?"Đang kiểm tra…":"Thử ghi và xóa file mẫu"}
   </button>
   <p role="status" aria-live="polite" className="small-muted">{text}</p>
 </div>;
}
