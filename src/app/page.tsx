import Link from "next/link";
import { AppCard } from "@/components/app-card";
import { listPublicApps } from "@/modules/catalog/service";

export default async function Home() {
  const { state, data } = await listPublicApps();
  return <>
    <section className="hero">
      <p className="eyebrow">AN IPA STORE · ỨNG DỤNG IOS</p>
      <h1>Ứng dụng của bạn.<br />Trải nghiệm của bạn.</h1>
      <p className="lead">Khám phá ứng dụng từ các nhà phát triển được phép phát hành. Trạng thái phân phối và điều kiện cài đặt luôn được trình bày rõ ràng.</p>
      <div className="hero-actions"><Link className="button" href="/apps">Khám phá ứng dụng</Link><Link className="secondary-button" href="/devices/register">Thiết bị của tôi</Link></div>
    </section>
    <section className="panel">
      <div className="section-title"><h2>Ứng dụng mới nhất</h2><Link className="minor-link" href="/apps">Xem danh mục →</Link></div>
      {state === "available" && data.length ? <div className="catalog-list">{data.slice(0, 6).map(a => <AppCard key={a.slug} app={a} />)}</div>
      : <div className="empty"><span className="app-mark" aria-hidden="true">A</span><h3>{state === "unavailable" ? "Danh mục đang tạm gián đoạn" : "Chưa có ứng dụng được xuất bản"}</h3>
      <p>{state === "unconfigured" ? "Hệ thống chưa kết nối dữ liệu ứng dụng." : state === "unavailable" ? "Không thể lấy dữ liệu lúc này." : "Các ứng dụng sẽ xuất hiện sau khi có bản phát hành đủ điều kiện."}</p></div>}
    </section>
    <section className="grid feature-grid"><article><p className="eyebrow">01 / PHÁT HÀNH CHÍNH THỨC</p><h2>App Store & TestFlight</h2><p>Truy cập kênh phát hành chính thức khi có liên kết đã xác minh.</p></article>
    <article><p className="eyebrow">02 / THIẾT BỊ ĐƯỢC PHÉP</p><h2>Phân phối Ad Hoc</h2><p>Thiết bị phải được xác minh và nằm trong provisioning profile hợp lệ trước khi được cấp quyền cài đặt.</p></article></section>
  </>;
}
