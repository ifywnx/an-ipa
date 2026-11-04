"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
export function AdminLogout(){
 const [busy,setBusy]=useState(false);
 const router=useRouter();
 async function logout(){
  setBusy(true);
  try{
    const response=await fetch("/api/admin/logout",{method:"POST",credentials:"same-origin"});
    if(response.ok){router.replace("/auth");router.refresh();}
  }finally{setBusy(false);}
 }
 return <button type="button" className="secondary-button admin-logout" disabled={busy} onClick={()=>void logout()}>
   {busy?"Đang thoát…":"Đăng xuất"}
 </button>;
}
