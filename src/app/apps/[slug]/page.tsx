import Link from "next/link";
import { notFound } from "next/navigation";
import { findPublicApp, validSlug } from "@/modules/catalog/service";
import { InstallChecklist, InstallFaq } from "@/components/install-guide";

export default async function AppDetails({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!validSlug(slug)) notFound();
  const { state, data: app } = await findPublicApp(slug);
  if (state === "available" && !app) notFound();
  if (state !== "available") return <section className="reading">
    <p className="eyebrow">CHI TIẾT ỨNG DỤNG</p><h1>Chưa thể hiển thị ứng dụng.</h1>
    <p>{state === "unconfigured" ? "Danh mục chưa được kết nối." : "Dịch vụ danh mục tạm thời không khả dụng."}</p>
    <Link href="/apps">Quay lại danh mục</Link>
  </section>;
  if (!app) notFound();
  return <section className="reading">
    <Link className="back-link" href="/apps">← Quay lại danh mục</Link>
    <div className="detail-heading">
      <span className="app-symbol large-symbol" aria-hidden="true">{app.title.charAt(0).toLocaleUpperCase("vi")}</span>
      <div><p className="eyebrow">{app.category}</p><h1>{app.title}</h1><p className="app-developer">{app.developer_name}</p></div>
    </div>
    <div className="panel"><h2>Giới thiệu</h2><p>{app.summary}</p></div>
    <div className="panel notice" role="note"><h2>Chưa mở cài đặt từ website</h2>
      <p>Thông tin xuất bản ứng dụng không đồng nghĩa thiết bị đủ điều kiện cài IPA. IPA được chủ cửa hàng ký bằng LCSign trên iPhone. Chỉ mở liên kết cài đặt sau khi server xác minh chữ ký, provisioning profile, quyền phân phối và điều kiện thiết bị.</p>
      <Link href="/devices/register">Tìm hiểu điều kiện thiết bị</Link>
    </div>
    <InstallChecklist />
    <InstallFaq />
  </section>;
}
