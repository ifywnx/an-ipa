"use client";
import {useCallback,useEffect,useState,type FormEvent} from 'react';
type Draft={id?:string;slug:string;name:string;developer:string;description:string;category:string;distribution_rights:string;rights_reference:string;updated_at?:string};
type App=Draft&{id:string;published:boolean};
type Audit={id:string;action:string;entity:string;created_at:string};
const blank:Draft={slug:'',name:'',developer:'',description:'',category:'Tiện ích',distribution_rights:'own',rights_reference:''};
const messages:Record<string,string>={APP_CHANGED:'Ứng dụng đã được sửa ở phiên khác. Hãy tải lại rồi thử tiếp.',SLUG_EXISTS:'Đường dẫn này đã được sử dụng.',RATE_LIMITED:'Bạn thao tác quá nhanh. Vui lòng đợi một phút.'};
export function AdminCatalog(){
 const [apps,setApps]=useState<App[]>([]),[draft,setDraft]=useState<Draft>({...blank}),[history,setHistory]=useState<Audit[]>([]);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const load=useCallback(async()=>{
  try{const [a,h]=await Promise.all([fetch('/api/admin/catalog',{cache:'no-store'}),fetch('/api/admin/catalog?history=true',{cache:'no-store'})]);if(!a.ok||!h.ok)throw Error();const [aa,hh]=await Promise.all([a.json(),h.json()]);setApps(aa.data);setHistory(hh.data);}
  catch{setMessage('Chưa đọc được dữ liệu. Hãy kiểm tra phiên Admin rồi tải lại.');}
 },[]);
 useEffect(()=>{void load();},[load]);
 async function mutate(action:'save'|'hide',data:Draft){
  setBusy(true);setMessage('');
  try{const r=await fetch('/api/admin/catalog',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,data})});const body=await r.json();if(!r.ok){setMessage(messages[body.error]||'Không lưu được. Kiểm tra thông tin và quyền Admin.');return;}setMessage(action==='hide'?'Đã ẩn ứng dụng.':'Đã lưu bản nháp, chưa xuất bản.');setDraft({...blank});await load();}
  catch{setMessage('Mất kết nối. Hãy tải lại danh sách trước khi gửi lại.');}finally{setBusy(false);}
 }
 function edit(app:App){const {published,...data}=app;void published;setDraft(data);setMessage('Đang sửa '+app.name+'. Lưu thay đổi sẽ đưa ứng dụng về bản nháp.');document.getElementById('catalog-editor')?.scrollIntoView({behavior:'smooth'});}
 function submit(e:FormEvent){e.preventDefault();void mutate('save',draft);}
 return <>
  <div className="panel"><div className="section-title"><h2>Danh sách ứng dụng</h2><button className="secondary-button" disabled={busy} onClick={()=>void load()}>Tải lại</button></div>
   {apps.length===0?<p>Chưa có ứng dụng. Tạo bản nháp đầu tiên bên dưới.</p>:apps.map(app=><article className="intake-item" key={app.id}><h3>{app.name}</h3><p>{app.developer} · {app.published?'Đang hiển thị':'Bản nháp'} · /apps/{app.slug}</p><button className="secondary-button" disabled={busy} onClick={()=>edit(app)}>Chỉnh sửa</button>{app.published&&<button className="secondary-button" disabled={busy} onClick={()=>void mutate('hide',{...blank,id:app.id,updated_at:app.updated_at})}>Ẩn ứng dụng</button>}</article>)}
  </div>
  <form className="panel catalog-editor" id="catalog-editor" onSubmit={submit}>
   <div className="section-title"><h2>{draft.id?'Chỉnh sửa bản nháp':'Thêm ứng dụng'}</h2>{draft.id&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>setDraft({...blank})}>Tạo mới</button>}</div>
   {([{key:'name',label:'Tên ứng dụng',max:120},{key:'slug',label:'Đường dẫn (chữ thường, số, dấu gạch ngang)',max:80},{key:'developer',label:'Nhà phát triển',max:120},{key:'category',label:'Danh mục',max:60}] as const).map(field=><label className="catalog-field" key={field.key}>{field.label}<input required maxLength={field.max} pattern={field.key==='slug'?'[a-z0-9]+(-[a-z0-9]+)*':undefined} value={draft[field.key]} disabled={busy} onChange={e=>setDraft({...draft,[field.key]:e.target.value})}/></label>)}
   <label className="catalog-field">Mô tả<textarea maxLength={10000} rows={5} disabled={busy} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
   <label className="catalog-field">Quyền phân phối<select disabled={busy} value={draft.distribution_rights} onChange={e=>setDraft({...draft,distribution_rights:e.target.value})}><option value="own">Ứng dụng do tôi sở hữu</option><option value="licensed">Được chủ sở hữu cấp phép</option></select></label>
   <label className="catalog-field">Ghi chú căn cứ quyền phân phối (chỉ Admin xem)<textarea required minLength={5} maxLength={2000} rows={3} disabled={busy} value={draft.rights_reference} onChange={e=>setDraft({...draft,rights_reference:e.target.value})}/></label>
   <p className="small-muted">Không nhập khóa ký, mật khẩu hoặc UDID vào mô tả. Lưu thông tin chưa cấp quyền tải IPA hay cài OTA.</p>
   <button className="button" type="submit" disabled={busy}>{busy?'Đang lưu…':'Lưu bản nháp'}</button>
   {message&&<p role="status">{message}</p>}
  </form>
  <section className="panel"><h2>Nhật ký thao tác</h2>{history.length===0?<p>Chưa có thao tác được ghi nhận.</p>:history.map(row=><p className="small-muted" key={row.id}>{new Date(row.created_at).toLocaleString('vi-VN')} · {row.action} · {row.entity}</p>)}</section>
 </>;
}
