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
 if(cloud&&json.token&&['/api/login','/api/signup','/api/linky/redeem'].includes(path))localStorage.setItem(tokenKey,json.token);
 if(cloud&&path==='/api/logout')localStorage.removeItem(tokenKey);
 return json;
}
// "Entrar com LINKY": começa na função (que guarda o pedido em cookie próprio) e volta com um
// bilhete que só esta aba consegue trocar pela sessão, graças ao valor guardado aqui.
const bindKey='only.linky.bind';
export function linkyStart(){if(!cloud)return;const bytes=crypto.getRandomValues(new Uint8Array(24)),bind=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');try{sessionStorage.setItem(bindKey,bind);}catch{}location.href=`${cloud.url}/functions/v1/only/api/linky/start?bind=${bind}`;}
export function linkyReturn(){const h=new URLSearchParams(location.hash.startsWith('#/')?'':location.hash.slice(1)),ticket=h.get('linky_login'),error=h.get('linky_error');if(!ticket&&!error)return null;history.replaceState(null,'',location.pathname+location.search);let bind='';try{bind=sessionStorage.getItem(bindKey)||'';sessionStorage.removeItem(bindKey);}catch{}return {ticket,bind,error,email:h.get('email')||''};}
