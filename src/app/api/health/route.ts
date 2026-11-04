export function GET() { return Response.json({status:"ok",stage:"bootstrap",distributionEnabled:false}, {headers:{"Cache-Control":"no-store"}}); }
