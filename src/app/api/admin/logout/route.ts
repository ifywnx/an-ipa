import {NextRequest,NextResponse} from "next/server";
import {ADMIN_COOKIE,sameOrigin} from "@/modules/auth/session";
import {adminConfig} from "@/modules/auth/admin-server";
export async function POST(request:NextRequest){
 const cfg=adminConfig();
 if(!cfg||!sameOrigin(request.headers.get("origin"),cfg.origin))
   return Response.json({ok:false},{status:403,headers:{"Cache-Control":"no-store"}});
 const response=NextResponse.json({ok:true},{headers:{"Cache-Control":"no-store"}});
 response.cookies.set(ADMIN_COOKIE,"",{path:"/",secure:true,httpOnly:true,sameSite:"strict",maxAge:0});
 return response;
}
