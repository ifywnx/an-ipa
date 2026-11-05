import Link from "next/link";
import { AppCard } from "@/components/app-card";
import { InstallFaq } from "@/components/install-guide";
import { listPublicApps } from "@/modules/catalog/service";
import { CERTIFICATE_PACKAGES, REGISTRATION_PACKAGES, formatVnd } from "@/modules/storefront/packages";

const TRUST_CHIPS = [
  "Ký thủ công cho từng thiết bị",
  "Ứng dụng được quét & kiểm tra trước khi phát hành",
  "Không bao giờ hỏi mật khẩu Apple ID của bạn",
  "Điều kiện cài đặt luôn nói rõ trước",
];

const STEPS = [
  {
    title: "Lấy UDID của máy bạn",
    body: "Mở trang Lấy UDID bằng Safari trên chính chiếc iPhone/iPad muốn cài app, tải hồ sơ cấu hình và UDID của máy sẽ được gửi về cửa hàng — không cần cài thêm ứng dụng lạ.",
  },
  {
    title: "Cửa hàng đăng ký & ký bản cài",
    body: "UDID của bạn được đăng ký với Apple và đưa vào hồ sơ ký. Bản IPA chỉ được phát hành sau khi đã qua bước quét và kiểm tra chữ ký ở khu vực cách ly.",
  },
  {
    title: "Cài qua liên kết, mở là dùng",
    body: "Khi thiết bị đủ điều kiện, bạn nhận liên kết cài đặt cho đúng máy của mình. iOS 16 trở lên nhớ bật Developer Mode trước khi mở app lần đầu.",
  },
];

export default async function Home() {
  const { state, data } = await listPublicApps();
  return <>
    <section className="home-hero">
      <p className="eyebrow">AN IPA STORE · ỨNG DỤNG IOS NGOÀI APP STORE</p>
      <h1>App hay cho iPhone của bạn,<br /><span className="hero-gradient">ký riêng cho từng máy.</span></h1>
      <p className="lead">AN IPA STORE phân phối ứng dụng iOS theo hình thức Ad Hoc: mỗi thiết bị được đăng ký bằng UDID, mỗi bản cài được ký và kiểm tra trước khi phát hành. Không cài qua trung gian lạ, không xin mật khẩu Apple ID.</p>
      <div className="hero-actions"><Link className="button" href="/udid">Lấy UDID của máy tôi</Link><Link className="secondary-button" href="/apps">Xem kho ứng dụng</Link></div>
      <div className="trust-chips">{TRUST_CHIPS.map((chip) => <span key={chip}>{chip}</span>)}</div>
    </section>

    <section className="pricing-section" id="goi-dang-ky" aria-labelledby="pricing-title">
      <p className="eyebrow">CHỌN GÓI ĐĂNG KÝ THIẾT BỊ</p>
      <h2 id="pricing-title">Một thiết bị, một gói rõ ràng</h2>
      <p className="section-lead">Gói quyết định thời gian cửa hàng hỗ trợ ký lại cho thiết bị của bạn. Mọi gói đều cài được toàn bộ ứng dụng trong kho — khác nhau ở thời gian hỗ trợ và mức ưu tiên.</p>
      <div className="pricing-grid">
        {REGISTRATION_PACKAGES.map((pkg) => (
          <article key={pkg.id} className={pkg.featured ? "price-card featured" : "price-card"}>
            {pkg.badge ? <p className="price-badge">{pkg.badge}</p> : null}
            <h3>{pkg.name}</h3>
            <p className="price-duration">{pkg.durationLabel}</p>
            <p className="price-value">{formatVnd(pkg.priceVnd)}</p>
            <p className="price-tagline">{pkg.tagline}</p>
            <ul className="price-features">
              {pkg.features.map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
            <Link className={pkg.featured ? "button price-cta" : "secondary-button price-cta"} href="/udid">Đăng ký thiết bị này</Link>
          </article>
        ))}
      </div>
      <p className="pricing-note">Mỗi gói áp dụng cho đúng 1 UDID. Chứng chỉ và hồ sơ ký có thể hết hạn hoặc bị Apple thu hồi ngoài ý muốn — cách cửa hàng xử lý trong từng trường hợp được ghi rõ ở trang <Link href="/policies/refund-warranty">đổi trả / bảo hành</Link>.</p>
    </section>

    <section className="pricing-section" id="goi-chung-chi" aria-labelledby="cert-title">
      <p className="eyebrow">CHỌN GÓI CHỨNG CHỈ P12</p>
      <h2 id="cert-title">Muốn tự ký app? Mua chứng chỉ, tự làm chủ</h2>
      <p className="section-lead">Khác gói ở trên ở một điểm: ở đây bạn nhận file chứng chỉ P12 + hồ sơ ký theo UDID của mình, rồi tự ký bất kỳ file IPA nào bằng ứng dụng ký (LCSign, ESign...). Gói phân tầng theo thời gian bảo hành — bị Apple thu hồi trong hạn thì được cấp lại miễn phí.</p>
      <div className="compare-grid">
        <article className="compare-card">
          <h3>Gói đăng ký thiết bị</h3>
          <p>Cửa hàng ký sẵn mọi thứ. Bạn chỉ việc lấy UDID, chờ phát hành rồi cài qua liên kết. Hợp với người muốn cài là dùng, không đụng vào file.</p>
          <Link className="minor-link" href="#goi-dang-ky">Xem các gói đăng ký ↑</Link>
        </article>
        <article className="compare-card">
          <h3>Gói chứng chỉ P12</h3>
          <p>Bạn cầm chứng chỉ và tự ký mọi file IPA bạn có. Hợp với người thích vọc, hay cài app ngoài kho của cửa hàng, hoặc ký cho nhiều bản khác nhau.</p>
          <Link className="minor-link" href="#goi-chung-chi">Bạn đang xem mục này ↓</Link>
        </article>
      </div>
      <div className="pricing-grid">
        {CERTIFICATE_PACKAGES.map((pkg) => (
          <article key={pkg.id} className={pkg.featured ? "price-card featured" : "price-card"}>
            {pkg.badge ? <p className="price-badge">{pkg.badge}</p> : null}
            <h3>{pkg.name}</h3>
            <p className="price-duration">{pkg.warrantyLabel}</p>
            <p className="price-value">{formatVnd(pkg.priceVnd)}</p>
            <p className="price-tagline">{pkg.tagline}</p>
            <ul className="price-features">
              {pkg.features.map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
            <Link className={pkg.featured ? "button price-cta" : "secondary-button price-cta"} href="/udid">Gửi UDID để cấp chứng chỉ</Link>
          </article>
        ))}
      </div>
      <p className="pricing-note">Chứng chỉ được cấp sau khi UDID của bạn đăng ký thành công, kèm mật khẩu mở file P12 lúc giao. Cửa hàng không bao giờ hỏi mật khẩu Apple ID hay mật khẩu riêng nào của bạn. Điều kiện bảo hành &amp; cấp lại được ghi rõ ở trang <Link href="/policies/refund-warranty">đổi trả / bảo hành</Link>.</p>
    </section>

    <section className="steps-section" aria-labelledby="steps-title">
      <p className="eyebrow">CÁCH HOẠT ĐỘNG</p>
      <h2 id="steps-title">Cài đặt chỉ qua 3 bước</h2>
      <div className="steps-grid">
        {STEPS.map((step, index) => (
          <article key={step.title} className="step-card">
            <p className="step-number" aria-hidden="true">{index + 1}</p>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </article>
        ))}
      </div>
    </section>

    <section className="panel">
      <div className="section-title"><h2>Kho ứng dụng</h2><Link className="minor-link" href="/apps">Xem danh mục →</Link></div>
      {state === "available" && data.length ? <div className="catalog-list">{data.slice(0, 6).map(a => <AppCard key={a.slug} app={a} />)}</div>
      : <div className="empty"><span className="app-mark" aria-hidden="true">A</span><h3>{state === "unavailable" ? "Danh mục đang tạm gián đoạn" : "Chưa có ứng dụng được xuất bản"}</h3>
      <p>{state === "unconfigured" ? "Hệ thống chưa kết nối dữ liệu ứng dụng." : state === "unavailable" ? "Không thể lấy dữ liệu lúc này." : "Các ứng dụng sẽ xuất hiện sau khi có bản phát hành đủ điều kiện."}</p></div>}
    </section>

    <section className="grid feature-grid why-grid">
      <article><p className="eyebrow">KÝ RIÊNG TỪNG MÁY</p><h2>Không dùng chứng chỉ chợ chung</h2><p>Bản cài của bạn được ký với hồ sơ chứa đúng UDID máy bạn, thay vì nhồi vào một chứng chỉ dùng chung cho hàng nghìn người lạ — loại chứng chỉ dễ bị Apple thu hồi hàng loạt nhất.</p></article>
      <article><p className="eyebrow">KIỂM TRA TRƯỚC PHÁT HÀNH</p><h2>Quét &amp; xác minh ở khu cách ly</h2><p>Mọi file IPA đều vào khu vực cách ly để quét cấu trúc và kiểm tra chữ ký (kể cả các thư viện lồng bên trong) trước khi khách nhận được liên kết cài đặt.</p></article>
      <article><p className="eyebrow">MINH BẠCH ĐIỀU KIỆN</p><h2>Nói rõ cài được hay chưa, vì sao</h2><p>Tải được file không đồng nghĩa cài được. Hệ thống chỉ mở liên kết cài đặt khi thiết bị của bạn đã đủ điều kiện thật — và luôn cho bạn biết còn thiếu bước nào.</p></article>
    </section>

    <section className="faq-section">
      <InstallFaq />
      <p className="help-text">Chưa rõ điều gì? Xem thêm trang <Link href="/support">Hỗ trợ</Link> hoặc kiểm tra <Link href="/devices">thiết bị của tôi</Link>.</p>
    </section>
  </>;
}
