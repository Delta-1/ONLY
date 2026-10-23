// Only the publishable key belongs in this module's public configuration.
export const cloud=window.ONLY_CLOUD||null;
export const pageBase=new URL('../',import.meta.url).href;
const tokenKey=cloud?`only.cloud.session.${new URL(cloud.url).hostname}`:'';
export function routeUrl(path){return cloud?`${pageBase}#${path}`:path;}
export function qrUrl(path){return cloud?`${cloud.url}/functions/v1/only/api/qr?path=${encodeURIComponent(path)}`:`/api/qr?path=${encodeURIComponent(path)}`;}
export async function request(path,body){
 let session='';if(cloud)session=localStorage.getItem(tokenKey)||'';
 const headers={'Content-Type':'application/json','X-Only-Request':'1',...(cloud?{apikey:cloud.publishableKey,...(session?{'X-Only-Session':session}:{})}:{})};
 const endpoint=cloud?`${cloud.url}/functions/v1/only${path}`:path;
 let response;try{response=await fetch(endpoint,{credentials:cloud?'omit':'same-origin',headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});}catch{throw Error('offline');}
 const json=await response.json().catch(()=>({error:'serverError'}));
 if(!response.ok){if(cloud&&response.status===401&&json.error==='loginRequired')localStorage.removeItem(tokenKey);throw Error(json.error||'serverError');}
 if(cloud&&json.token&&['/api/login','/api/signup'].includes(path))localStorage.setItem(tokenKey,json.token);
 if(cloud&&path==='/api/logout')localStorage.removeItem(tokenKey);
 return json;
}
