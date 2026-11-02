import {requireAdmin} from "@/modules/auth/admin-server";
export const dynamic="force-dynamic";
export default async function AdminLayout({children}:{children:React.ReactNode}){
  await requireAdmin();
  return <>{children}</>;
}
