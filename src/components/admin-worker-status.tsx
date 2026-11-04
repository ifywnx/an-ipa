"use client";
import {useCallback,useEffect,useState} from 'react';
type Health={configured:boolean;alerts:string[];runs:{id:string;kind:string;status:string;error_code:string|null;started_at:string}[]};
export function AdminWorkerStatus(){
 const [health,setHealth]=useState<Health|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[runId,setRunId]=useState('');
 const load=useCallback(async()=>{
  setBusy(true);
  try{
   const response=await fetch('/api/admin/worker',{cache:'no-store'});
   if(!response.ok)throw Error();
   setHealth(await response.json());
   if(runId){const r=await fetch('/api/admin/worker?runId='+encodeURIComponent(runId),{cache:'no-store'});if(r.ok){const data=await r.json();setMessage('Kiểm tra môi trường: '+data.status);}}
  }catch{setMessage('Không đọc được trạng thái worker. Hãy kiểm tra phiên Admin và cấu hình Preview.');}
  finally{setBusy(false);}
 },[runId]);
 useEffect(()=>{void load();},[load]);
 async function selfTest(){setBusy(true);try{const r=await fetch('/api/admin/worker',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'self-test'})});if(!r.ok)throw Error();const data=await r.json();setRunId(data.runId);setMessage('Đã xếp lịch kiểm tra môi trường. Bấm làm mới để xem kết quả.');}catch{setMessage('Chưa chạy được kiểm tra môi trường. Chức năng chỉ mở trên Preview.');}finally{setBusy(false);}}
 return <section className="panel" aria-label="Trạng thái worker">
  <div className="section-title"><h2>Worker kiểm tra IPA</h2><button className="secondary-button" disabled={busy} onClick={()=>void load()}>Làm mới</button></div>
  <p>{health?.configured?'Đã cấu hình worker Vercel.':'Worker chưa sẵn sàng hoặc đang tải trạng thái.'}</p>
  <p className="small-muted">Quét cấu trúc file và đọc profile không đồng nghĩa với xác minh chữ ký Apple. IPA vẫn ở kho cách ly và chưa được cài OTA.</p>
  {(health?.alerts?.length??0)>0&&<p role="status">Có tác vụ cần kiểm tra hoặc worker chưa được cấu hình.</p>}
  <button className="secondary-button" disabled={busy} onClick={()=>void selfTest()}>Kiểm tra môi trường Preview</button>
  {message&&<p role="status">{message}</p>}
  {health?.runs?.map(run=><p key={run.id} className="small-muted">{run.kind} · {run.status} · {new Date(run.started_at).toLocaleString('vi-VN')}{run.error_code?' · '+run.error_code:''}</p>)}
 </section>;
}
