import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,digest} from '../supabase/functions/only/handler.js';

const account={id:crypto.randomUUID(),business:crypto.randomUUID(),email:'dono@loja.test',name:'Dono',role:'owner',active:true};
function setup(who){
 const sessions=new Map(),calls=[];
 const handler=createHandler({qr:async()=>'',sealSecret:'segredo-de-teste',linky:{start:async()=>({url:'https://linky.test/auth',pending:{verifier:'v',state:'s',nonce:'n'}}),finish:async(search,p)=>{assert.equal(p.state,'s');assert.match(search,/code=abc/);return {...who};}},
  rpc:async(op,data)=>{calls.push(op);if(op==='rate_limit')return {allowed:true};if(op==='account_email')return data.email===account.email?{...account,password_hash:'x'}:null;if(op==='new_session'){sessions.set(data.hash,data.id);return {ok:true};}if(op==='account_session')return sessions.get(data.hash)===account.id?account:null;throw Error('op '+op);}});
 const get=(path,cookie)=>handler(new Request('https://x.supabase.co/functions/v1/only'+path,{headers:cookie?{cookie}:{}}));
 const redeem=body=>handler(new Request('https://x.supabase.co/functions/v1/only/api/linky/redeem',{method:'POST',headers:{'X-Only-Request':'1','Content-Type':'application/json'},body:JSON.stringify(body)}));
 return {who,calls,get,redeem};
}
const hashOf=r=>new URLSearchParams(new URL(r.headers.get('location')).hash.slice(1));
const bind='b'.repeat(30);
async function login(f,b=bind){const s=await f.get('/api/linky/start?bind='+b);assert.equal(s.status,303);const cookie=s.headers.get('set-cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Lax/);assert.match(cookie,/Path=\/functions\/v1\/only\/api\/linky/);return f.get('/api/linky/callback?code=abc&state=s',cookie.split(';')[0]);}

test('LINKY entra na conta ONLY do mesmo e-mail verificado, só na aba que começou',async()=>{
 const f=setup({sub:'l1',email:'Dono@Loja.test',emailVerified:true});
 const ticket=hashOf(await login(f)).get('linky_login');assert.ok(ticket);
 assert.equal((await f.redeem({ticket,bind:'c'.repeat(30)})).status,400,'outra aba não usa o bilhete');
 const ok=await f.redeem({ticket,bind});assert.equal(ok.status,200);const body=await ok.json();assert.match(body.token,/^[a-f0-9]{64}$/);assert.equal(body.user.email,account.email);
 assert.ok(!f.calls.includes('create_company'),'nenhuma conta criada');
});
test('LINKY sem conta, sem e-mail verificado ou sem cookie não entra',async()=>{
 const f=setup({sub:'l2',email:'novo@loja.test',emailVerified:true});
 assert.equal(hashOf(await login(f)).get('linky_error'),'conta');
 f.who.emailVerified=false;assert.equal(hashOf(await login(f)).get('linky_error'),'email');
 assert.equal(hashOf(await f.get('/api/linky/callback?code=abc&state=s')).get('linky_error'),'expirado');
 assert.equal(hashOf(await f.get('/api/linky/start?bind=curto')).get('linky_error'),'falhou');
 assert.equal((await f.redeem({ticket:'x',bind})).status,400);
});
