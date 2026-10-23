import {defaults,initialState,mutate,publicCatalog,publicMutation,resolveLink,workspace,fail,text,id,hex,owner} from './domain.js';
const enc=new TextEncoder();
export async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(value))),v=>v.toString(16).padStart(2,'0')).join('');}
const checkPassword=p=>{if(typeof p!=='string'||p.length<8||p.length>128)fail('passwordLength');return p;};
async function derive(pass,salt,iterations){const key=await crypto.subtle.importKey('raw',enc.encode(pass),'PBKDF2',false,['deriveBits']);return Array.from(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode(salt),iterations},key,256)),v=>v.toString(16).padStart(2,'0')).join('');}
export async function passwordHash(pass){checkPassword(pass);const salt=hex(16);return `pbkdf2$600000$${salt}$${await derive(pass,salt,600000)}`;}
export async function passwordMatches(pass,encoded){if(typeof pass!=='string'||pass.length>128||!encoded)return false;const [kind,n,salt,expected]=encoded.split('$');if(kind!=='pbkdf2'||Number(n)!==600000||!salt||!expected)return false;const actual=await derive(pass,salt,Number(n));let diff=actual.length^expected.length;for(let i=0;i<actual.length;i++)diff|=actual.charCodeAt(i)^expected.charCodeAt(i);return diff===0;}
const safeUser=a=>({id:a.id,business:a.business,email:a.email,name:a.name,role:a.role});
const checkedEmail=e=>{const v=text(e).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))fail('invalidEmail');return v;};
export function createHandler({rpc,qr,publicBase='https://delta-1.github.io/ONLY/'}){
 const pageOrigin=new URL(publicBase).origin;
 const limit=async(key,max)=>{const r=await rpc('rate_limit',{key:await digest(key),maximum:max});if(!r?.allowed)fail('rateLimited',429);};
 const findWorkspace=async(params)=>{const row=await rpc('read_workspace',params);if(!row)fail('notFound',404);return row;};
 async function changeWorkspace(params,fn){for(let i=0;i<7;i++){const row=await findWorkspace(params),state=structuredClone(row.body),result=fn(state);const saved=await rpc('write_workspace',{id:row.id,version:row.version,body:state});if(saved?.updated)return result;}fail('concurrentUpdate',409);}
 return async req=>{
  const origin=req.headers.get('origin')||'',allowed=!origin||origin===pageOrigin||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':allowed?(origin||pageOrigin):pageOrigin,'Access-Control-Allow-Headers':'apikey,content-type,x-only-request,x-only-session,authorization','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Vary':'Origin'};
  const send=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
  try{
   if(!allowed)fail('forbidden',403);if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
   const url=new URL(req.url),apiStart=url.pathname.indexOf('/api/'),path=apiStart<0?'/health':url.pathname.slice(apiStart),post=req.method==='POST';
   if(path==='/health'){if(!url.pathname.endsWith('/only')&&!url.pathname.endsWith('/only/health')&&!url.pathname.endsWith('/only/'))fail('notFound',404);await rpc('health',{});return send({ok:true,app:'ONLY',database:'connected',version:'1.1.0'});}
   if(!['GET','POST'].includes(req.method))fail('notFound',404);
   const ip=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||req.headers.get('cf-connecting-ip')||'unknown';
   let b={};if(post){if(req.headers.get('x-only-request')!=='1'||!req.headers.get('content-type')?.startsWith('application/json'))fail('forbidden',403);const input=await req.text();if(enc.encode(input).length>1800000)fail('bodyTooLarge',413);try{b=JSON.parse(input);}catch{fail('invalidBody');}if(!b||typeof b!=='object'||Array.isArray(b))fail('invalidBody');}
   if(path==='/api/qr'&&req.method==='GET'){
    await limit(`qr:${ip}`,300);const relative=url.searchParams.get('path')||'';if(!/^\/(store|mobile|collaborate)\/[A-Za-z0-9_-]+$/.test(relative))fail('invalidLink');
    return new Response(await qr(`${publicBase}#${relative}`),{headers:{...headers,'Content-Type':'image/svg+xml'}});
   }
   if(post&&['/api/signup','/api/login'].includes(path)){
    const email=checkedEmail(b.email);await limit(`login-ip:${ip}`,80);await limit(`login-email:${email}`,18);
    const raw=hex(32),sessionHash=await digest(raw);
    if(path==='/api/signup'){
     const name=text(b.name),businessName=text(b.businessName);if(!name||!businessName)fail('required');if(await rpc('account_email',{email}))fail('emailUsed',409);
     const userId=id(),business=id(),code=hex(6).toUpperCase(),state=initialState({id:business,code,...defaults,name:businessName});
     const account=await rpc('create_company',{id:userId,business,code,state,email,name,password_hash:await passwordHash(b.password),session_hash:sessionHash});return send({token:raw,user:safeUser(account)});
    }
    const account=await rpc('account_email',{email});if(!account||!await passwordMatches(b.password,account.password_hash))fail('invalidLogin',401);
    await rpc('new_session',{id:account.id,hash:sessionHash});return send({token:raw,user:safeUser(account)});
   }
   const sessionRaw=req.headers.get('x-only-session')||'',sessionHash=sessionRaw?await digest(sessionRaw):'';
   if(post&&path==='/api/logout'){if(sessionHash)await rpc('logout',{hash:sessionHash});return send({ok:true});}
   if(post&&path==='/api/join'){
    await limit(`join:${ip}`,50);const code=text(b.code).toUpperCase(),row=await findWorkspace({mobile_code:code});resolveLink(row.body,code,'mobile','');return send({path:`/mobile/${code}`});
   }
   const pub=path.match(/^\/api\/public\/(store|mobile|collaborate)\/([A-Za-z0-9_-]+)(?:\/(order|draft))?$/);
   if(pub){await limit(`public:${ip}`,600);const [,kind,key,action]=pub,keyHash=await digest(key),params=kind==='store'?{code:key}:{token_hash:keyHash,mobile_code:kind==='mobile'?key:undefined};
    if(!action&&req.method==='GET'){const row=await findWorkspace(params);return send(publicCatalog(row.body,key,kind,keyHash));}
    if(post&&action)return send(await changeWorkspace(params,s=>publicMutation(s,key,kind,action,b,keyHash)),201);fail('notFound',404);
   }
   if(!sessionHash)fail('loginRequired',401);const account=await rpc('account_session',{hash:sessionHash});if(!account)fail('loginRequired',401);const user=safeUser(account),params={id:user.business};
   if(path==='/api/workspace'&&req.method==='GET'){const row=await findWorkspace(params),users=user.role==='owner'?await rpc('list_users',{business:user.business}):[];return send(workspace(row.body,user,users));}
   if(!post)fail('notFound',404);
   if(path==='/api/users'){owner(user);const email=checkedEmail(b.email),name=text(b.name);if(!name)fail('required');const added=await rpc('add_user',{actor:user.id,business:user.business,id:id(),email,name,password_hash:await passwordHash(b.password)});return send(safeUser(added));}
   if(path==='/api/password'){const saved=await rpc('account_email',{email:user.email});if(!await passwordMatches(b.currentPassword,saved.password_hash))fail('invalidLogin',401);return send(await rpc('change_password',{id:user.id,password_hash:await passwordHash(b.password),keep_hash:sessionHash}));}
   const linkToken=path==='/api/links'?hex(24):'',context=linkToken?{linkToken,linkHash:await digest(linkToken),linkCode:hex(6).toUpperCase()}:{};
   return send(await changeWorkspace(params,s=>mutate(s,user,path,b,context)),path==='/api/sales'?201:200);
  }catch(e){if(!e.status&&!['emailUsed','forbidden'].includes(e.message))console.error('ONLY cloud request failed:',e.message);const message=e.status?e.message:e.message==='emailUsed'?'emailUsed':'serverError';return send({error:message},e.status|| (message==='emailUsed'?409:500));}
 };
}
