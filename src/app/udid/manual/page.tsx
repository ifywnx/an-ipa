"use client";
import {useEffect,useState,type FormEvent} from "react";
import Link from "next/link";
type State={requestId?:string;status?:string;udidSuffix?:string;message?:string;error?:string};
export default function ManualUdid(){
 const [udid,setUdid]=useState("");const [label,setLabel]=useState("");
 const [consent,setConsent]=useState(false);const [busy,setBusy]=useState(false);
 const [record,setRecord]=useState<State|null>(null);const [notice,setNotice]=useState("");
 useEffect(()=>{
   void fetch("/api/devices/manual",{cache:"no-store"}).then(async r=>{
     if(r.ok){const data=await r.json() as State;if(data.requestId)setRecord(data);}
   }).catch(()=>{});
 },[]);
 async function submit(e:FormEvent<HTMLFormElement>){
   e.preventDefault();if(!consent||busy)return;
   setBusy(true);setNotice("");
   try{
     const r=await fetch("/api/devices/manual",{
       method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",
       body:JSON.stringify({consent,udid,deviceLabel:label})
     });
     const result=await r.json() as State;
     if(!r.ok){
       setNotice(r.status===503?"Chưa mở tiếp nhận UDID trên website.":
         r.status===429?"Yêu cầu bị giới hạn hoặc trùng lặp. Vui lòng thử lại sau.":
         "UDID hoặc thông tin chưa hợp lệ.");
     }else{setRecord(result);setUdid("");setNotice("Yêu cầu đã nhận, đang chờ xác minh.");}
   }catch{setNotice("Không kết nối được đến máy chủ.");}
   finally{setBusy(false);}
 }
 async function remove(){
   setBusy(true);setNotice("");
   try{
     const r=await fetch("/api/devices/manual",{method:"DELETE",credentials:"same-origin"});
     if(!r.ok)throw Error("delete failed");
     setRecord(null);setConsent(false);setNotice("Đã xóa yêu cầu của phiên này.");
   }catch{setNotice("Không xóa được yêu cầu lúc này.");}
   finally{setBusy(false);}
 }
 return <section className="reading">
   <Link className="back-link" href="/udid">← Quay lại Profile Service</Link>
   <p className="eyebrow">AN IPA STORE · PHƯƠNG ÁN THỦ CÔNG</p>
   <h1>Gửi UDID thiết bị.</h1>
   <p className="lead">Không cần đăng nhập. UDID được mã hóa khi gửi lên máy chủ. Mã UDID nhập thủ công không chứng minh thiết bị đã đăng ký với Apple và không tự cấp quyền cài IPA.</p>
   {record?.requestId ? <div className="panel" role="status">
     <h2>Yêu cầu của bạn</h2><p>Mã: <code>{record.requestId}</code></p>
     <p>Trạng thái: <strong>{record.status==="pending_unverified"?"Chờ xác minh":record.status}</strong></p>
     {record.udidSuffix&&<p>UDID: ••••{record.udidSuffix}</p>}
     <button className="enroll-primary" type="button" disabled={busy} onClick={()=>void remove()}>Xóa UDID của phiên này</button>
   </div> : <form className="panel manual-udid-form" onSubmit={e=>void submit(e)}>
     <label htmlFor="device-udid">UDID iPhone / iPad</label>
     <input id="device-udid" required autoComplete="off" spellCheck={false}
       maxLength={50} value={udid} onChange={e=>setUdid(e.target.value)} placeholder="Dán UDID tại đây"/>
     <label htmlFor="device-label">Tên thiết bị (không bắt buộc)</label>
     <input id="device-label" maxLength={80} value={label}
       onChange={e=>setLabel(e.target.value)} placeholder="Ví dụ: iPhone của tôi"/>
     <label className="enroll-consent">
       <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>
       <span>Tôi đồng ý gửi UDID để kiểm tra điều kiện phân phối và hiểu yêu cầu này chưa được xác minh, có thể bị từ chối hoặc xóa.</span>
     </label>
     <button className="enroll-primary" type="submit" disabled={busy||!consent}>{busy?"Đang gửi…":"Gửi yêu cầu UDID"}</button>
   </form>}
   {notice&&<p role="status" className="enroll-note">{notice}</p>}
   <p className="enroll-note">Nếu chưa biết UDID, hãy dùng phương thức được Apple hỗ trợ. Không gửi mật khẩu Apple ID, IMEI hoặc file chứng chỉ ký ứng dụng.</p>
 </section>;
}
