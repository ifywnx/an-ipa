import Link from 'next/link';
import {AdminCatalog} from '@/components/admin-catalog';
export default function AdminApps(){return <section className="reading wide-reading admin-mobile"><Link className="back-link" href="/admin">← Quay lại Admin</Link><p className="eyebrow">DANH MỤC ỨNG DỤNG</p><h1>Ứng dụng của bạn.</h1><p className="lead">Chuẩn bị thông tin ứng dụng, lưu bản nháp và theo dõi lịch sử chỉnh sửa. Xuất bản chỉ được mở sau khi phiên bản IPA vượt qua xác minh.</p><AdminCatalog/></section>;}
