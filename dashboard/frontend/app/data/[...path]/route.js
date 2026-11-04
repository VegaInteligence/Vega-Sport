export const dynamic = "force-dynamic";
const gone=()=>new Response(null,{status:410,headers:{"Cache-Control":"no-store"}});
export {gone as GET,gone as HEAD,gone as POST,gone as PUT,gone as DELETE};
