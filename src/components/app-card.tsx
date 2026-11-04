import Link from "next/link";
import type { PublicApp } from "@/modules/catalog/types";

export function AppCard({ app }: { app: PublicApp }) {
  return <article className="app-card">
    <div className="app-symbol" aria-hidden="true">{app.title.charAt(0).toLocaleUpperCase("vi")}</div>
    <div className="app-content">
      <p className="app-category">{app.category}</p>
      <h3><Link href={`/apps/${app.slug}`}>{app.title}</Link></h3>
      <p className="app-summary">{app.summary}</p>
      <p className="app-developer">{app.developer_name}</p>
    </div>
    <Link className="app-details" href={`/apps/${app.slug}`} aria-label={`Xem chi tiết ${app.title}`}>Chi tiết</Link>
  </article>;
}
