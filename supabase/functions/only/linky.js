// "Entrar com LINKY" no ONLY (padrão UWY). O código é trocado pela função, nunca no navegador.
// Pedido em andamento: cookie HttpOnly cifrado (AES-256-GCM) na própria função, 10 minutos.
// Retorno: bilhete cifrado de 2 minutos, preso a um valor aleatório que só a aba que começou
// o login conhece (sessionStorage). A conta ONLY é a do mesmo e-mail verificado no LINKY;
// nada é criado, e o login por e-mail e senha continua igual.
const enc=new TextEncoder(),dec=new TextDecoder();
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64=text=>Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function key(secret,purpose){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',enc.encode(`only-linky:${purpose}:${secret}`)),'AES-GCM',false,['encrypt','decrypt']);}
export async function seal(secret,purpose,value){const iv=crypto.getRandomValues(new Uint8Array(12)),body=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(secret,purpose),enc.encode(JSON.stringify(value))));const out=new Uint8Array(12+body.length);out.set(iv);out.set(body,12);return b64(out);}
export async function unseal(secret,purpose,raw,maxAge,now=Date.now()){if(typeof raw!=='string'||!raw||raw.length>4096)return null;try{const data=unb64(raw),value=JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:data.subarray(0,12)},await key(secret,purpose),data.subarray(12))));return now-value.at<=maxAge&&value.at<=now+5000?value:null;}catch{return null;}}
export const COOKIE='only_linky',PENDING_MS=600000,TICKET_MS=120000;
export const readCookie=(req,name)=>(req.headers.get('cookie')||'').split(/;\s*/).find(c=>c.startsWith(name+'='))?.slice(name.length+1);
export const BIND=/^[A-Za-z0-9_-]{22,64}$/;
