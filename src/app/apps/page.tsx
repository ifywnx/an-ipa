import Link from "next/link";
import { AppCard } from "@/components/app-card";
import { filterPublicApps, listPublicApps } from "@/modules/catalog/service";

type Search = { q?: string | string[]; category?: string | string[] };
export default async function AppsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const input = await searchParams;
  const search = typeof input.q === "string" ? input.q.slice(0, 60) : "";
  const category = typeof input.category === "string" ? input.category.slice(0, 60) : "";
  const result = await listPublicApps();
  const categories = [...new Set(result.data.map(app => app.category))].sort();
  const visible = filterPublicApps(result.data, search, category);
  return <section className="reading wide-reading">
    <p className="eyebrow">DANH MỤC ỨNG DỤNG</p>
    <h1>Khám phá ứng dụng.</h1>
    <p className="lead">Danh mục chỉ hiển thị những ứng dụng có trạng thái xuất bản hợp lệ. Không có bản cài đặt chưa được kiểm chứng.</p>
    <form className="catalog-form" action="/apps" method="get" role="search">
      <label htmlFor="catalog-search">Tìm theo tên hoặc nhà phát triển</label>
      <div className="catalog-fields">
        <input id="catalog-search" name="q" type="search" maxLength={60} placeholder="Tìm ứng dụng…" defaultValue={search} />
        <select id="catalog-category" name="category" defaultValue={category} aria-label="Lọc danh mục">
          <option value="">Tất cả danh mục</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="button" type="submit">Tìm kiếm</button>
      </div>
    </form>
    {result.state === "unconfigured" ? <div className="panel notice"><h2>Danh mục chưa kết nối</h2><p>Quản trị viên chưa cấu hình Supabase. Hệ thống chưa xuất bản ứng dụng nào.</p></div>
      : result.state === "unavailable" ? <div className="panel notice" role="status"><h2>Không tải được danh mục</h2><p>Vui lòng thử lại sau. Không có bản cài đặt nào được cung cấp trong trạng thái này.</p></div>
      : visible.length ? <div className="catalog-list">{visible.map(app => <AppCard key={app.slug} app={app} />)}</div>
      : <div className="panel notice"><h2>Chưa tìm thấy ứng dụng</h2><p>Thử từ khóa hoặc danh mục khác. Chỉ các ứng dụng đã xuất bản mới được hiển thị.</p></div>}
    <p className="help-text"><Link href="/support">Tìm hiểu điều kiện phân phối ứng dụng iOS</Link></p>
  </section>;
}
