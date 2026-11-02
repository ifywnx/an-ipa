"use client";
import {useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";

export function AdminLoginForm(){
 const [email,setEmail]=useState("");
 const [password,setPassword]=useState("");
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState("");
 const router=useRouter();
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;
  setBusy(true);setNotice("");
  try{
    const response=await fetch("/api/admin/login",{
      method:"POST",credentials:"same-origin",cache:"no-store",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({email:email.trim(),password})
    });
    setPassword("");
    if(response.ok){
      router.replace("/admin");
      router.refresh();
      return;
    }
    setNotice(response.status===503?"Đăng nhập Admin chưa được cấu hình hoặc dịch vụ tạm thời không khả dụng.":
      "Email, mật khẩu chưa chính xác hoặc tài khoản chưa được cấp quyền Admin.");
  }catch{
    setNotice("Không thể kết nối. Vui lòng kiểm tra mạng và thử lại.");
  }finally{setBusy(false);}
 }
 return <form onSubmit={e=>void submit(e)} className="panel admin-auth-form">
   <label htmlFor="admin-email">Email quản trị viên</label>
   <input id="admin-email" type="email" autoComplete="username" required maxLength={254}
     value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email Admin"/>
   <label htmlFor="admin-password">Mật khẩu</label>
   <input id="admin-password" type="password" autoComplete="current-password" required minLength={8}
     value={password} onChange={e=>setPassword(e.target.value)} placeholder="Mật khẩu Admin"/>
   <button type="submit" className="button admin-auth-submit" disabled={busy}>
     {busy?"Đang xác minh…":"Đăng nhập Admin"}
   </button>
   {notice&&<p role="alert" className="enroll-alert">{notice}</p>}
   <p className="small-muted">Chỉ tài khoản đã được chủ website cấp quyền Admin trong Supabase mới được truy cập. Không có đăng ký công khai.</p>
 </form>;
}
