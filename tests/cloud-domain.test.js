import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaults,initialState,mutate,workspace,publicCatalog,publicMutation} from '../supabase/functions/only/domain.js';
import {passwordHash,passwordMatches,digest} from '../supabase/functions/only/handler.js';
const owner={id:crypto.randomUUID(),business:crypto.randomUUID(),name:'Admin',role:'owner'};
const make=()=>initialState({...defaults,id:owner.business,code:'ONLYTEST'});
const add=(s,body)=>mutate(s,owner,'/api/products',{name:'Café',code:'CAFE',prices:{BRL:10,BOB:15,USD:3,EUR:2},stock:10,...body});
const open=s=>mutate(s,owner,'/api/registers/open',{name:'Caixa',currency:'BRL',opening:50});

test('cloud native prices, server totals, stock and idempotency',()=>{const s=make(),p=add(s),r=open(s),payload={requestId:crypto.randomUUID(),registerId:r.id,currency:'BRL',method:'cash',received:'30,00',items:[{id:p.id,quantity:2,price:1}]};const a=mutate(s,owner,'/api/sales',payload),b=mutate(s,owner,'/api/sales',payload);assert.equal(a.id,b.id);assert.equal(a.total,2000);assert.equal(a.change,1000);assert.equal(p.stock,8);assert.equal(workspace(s,owner).registers[0].expected,7000);});
test('cloud client balances, partial payments and later receipts',()=>{const s=make(),p=add(s),r=open(s),c=mutate(s,owner,'/api/clients',{name:'Cliente'});const b={requestId:crypto.randomUUID(),registerId:r.id,currency:'BRL',method:'cash',received:4,items:[{id:p.id,quantity:1}]};assert.throws(()=>mutate(s,owner,'/api/sales',b),/clientRequired/);const sale=mutate(s,owner,'/api/sales',{...b,clientId:c.id,allowPartial:true});assert.equal(sale.due,600);mutate(s,owner,'/api/receipts',{clientId:c.id,registerId:r.id,currency:'BRL',amount:6,method:'cash'});const w=workspace(s,owner);assert.equal(w.clients[0].balances.BRL,0);assert.equal(w.sales[0].outstanding,0);});
test('cloud checkout validates cumulative quantities and tenant-owned item IDs',()=>{const s=make(),p=add(s),r=open(s);const b={requestId:crypto.randomUUID(),registerId:r.id,currency:'BRL',method:'cash',received:200,items:[{id:p.id,quantity:6},{id:p.id,quantity:6}]};assert.throws(()=>mutate(s,owner,'/api/sales',b),/insufficientStock/);assert.throws(()=>mutate(s,owner,'/api/sales',{...b,items:[{id:crypto.randomUUID(),quantity:1}]}),/notFound/);assert.equal(p.stock,10);});
test('cashier authorization protects edits and other registers',()=>{const s=make(),r=open(s),u={...owner,id:crypto.randomUUID(),role:'cashier'};assert.throws(()=>mutate(s,u,'/api/products',{name:'No'}),/forbidden/);assert.throws(()=>mutate(s,u,'/api/registers/close',{id:r.id,counted:0}),/forbidden/);assert.throws(()=>mutate(s,u,'/api/movements',{registerId:r.id,amount:10,kind:'out',note:'No'}),/forbidden/);});
test('cloud public store excludes confidential state and prices orders on server',()=>{const s=make(),p=add(s);s.business.storeEnabled=true;const c=publicCatalog(s,'ONLYTEST','store','');assert.equal(c.products[0].cost,undefined);assert.equal(c.products[0].wholesale,undefined);assert.equal(c.users,undefined);const payload={requestId:crypto.randomUUID(),currency:'BRL',customer:'Pessoa',phone:'999',items:[{id:p.id,quantity:1,price:0}]};const a=publicMutation(s,'ONLYTEST','store','order',payload,''),b=publicMutation(s,'ONLYTEST','store','order',payload,'');assert.equal(a.id,b.id);assert.equal(s.orders[0].total,1000);assert.equal(p.stock,10);});
test('collaboration requires approval and links revoke by token or code',()=>{const s=make();mutate(s,owner,'/api/links',{kind:'collaborate'},{linkToken:'raw',linkHash:'hashed',linkCode:'CODE'});publicMutation(s,'raw','collaborate','draft',{name:'Novo',prices:{BRL:5},stock:2},'hashed');assert.equal(s.products.length,0);mutate(s,owner,'/api/drafts/approve',{id:s.drafts[0].id});assert.equal(s.products[0].prices.BRL,500);mutate(s,owner,'/api/links/revoke',{code:'CODE'});assert.throws(()=>publicCatalog(s,'raw','collaborate','hashed'),/expiredLink/);});
test('cloud cancellation restores stock and cash, then closing locks register',()=>{const s=make(),p=add(s),r=open(s),sale=mutate(s,owner,'/api/sales',{requestId:crypto.randomUUID(),registerId:r.id,currency:'BRL',method:'cash',received:10,items:[{id:p.id,quantity:1}]});mutate(s,owner,'/api/sales/cancel',{id:sale.id});assert.equal(p.stock,10);const closed=mutate(s,owner,'/api/registers/close',{id:r.id,counted:50},{closePinVerified:true});assert.equal(closed.difference,0);assert.throws(()=>mutate(s,owner,'/api/sales',{requestId:crypto.randomUUID(),registerId:r.id,items:[]}),/openRegisterRequired/);});
test('password hashing uses individual salts and verifies without plaintext storage',async()=>{const a=await passwordHash('test-only-123'),b=await passwordHash('test-only-123');assert.notEqual(a,b);assert.ok(!a.includes('test-only-123'));assert.equal(await passwordMatches('test-only-123',a),true);assert.equal(await passwordMatches('wrong',a),false);assert.equal((await digest('session')).length,64);});

test('cloud handler verifies the closing PIN, hides hashes and persists independent feedback flags',async()=>{
 const {createHandler}=await import('../supabase/functions/only/handler.js');
 const s=make(),first=open(s),second=mutate(s,{...owner,id:crypto.randomUUID(),role:'cashier'},'/api/registers/open',{name:'Segundo',currency:'BOB',opening:30});
 let state=s,version=1;
 const handler=createHandler({qr:async()=>'',rpc:async(op,data)=>{
  if(op==='account_session')return {...owner,email:'owner@example.test'};
  if(op==='read_workspace')return {id:owner.business,version,body:structuredClone(state)};
  if(op==='write_workspace'){if(data.version!==version)return {updated:false};state=structuredClone(data.body);version++;return {updated:true};}
  if(op==='rate_limit')return {allowed:true};if(op==='list_users')return [];
  throw Error('Unexpected operation '+op);
 }});
 const call=async(path,body)=>{const response=await handler(new Request('https://test.invalid/functions/v1/only'+path,{method:body?'POST':'GET',headers:{'X-Only-Session':'test','X-Only-Request':'1','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));return {status:response.status,body:await response.json()};};
 assert.equal((await call('/api/registers/close',{id:first.id,counted:50})).body.error,'invalidClosingPin');
 assert.equal((await call('/api/registers/close',{id:first.id,counted:50,pin:'0000'})).status,403);
 assert.equal((await call('/api/registers/close',{id:first.id,counted:50,pin:'1234'})).status,200);
 const updated=await call('/api/settings',{...defaults,closePin:'5678',soundEffects:false,saleAnimations:true});
 assert.equal(updated.status,200);assert.equal(updated.body.closePinHash,undefined);assert.ok(state.business.closePinHash.startsWith('pbkdf2$'));
 const publicState=(await call('/api/workspace')).body;
 assert.equal(publicState.business.closePinHash,undefined);assert.equal(publicState.business.soundEffects,false);assert.equal(publicState.business.saleAnimations,true);
 assert.equal((await call('/api/registers/close',{id:second.id,counted:30,pin:'1234'})).body.error,'invalidClosingPin');
 assert.equal((await call('/api/registers/close',{id:second.id,counted:30,pin:'5678'})).status,200);
 assert.ok(state.registers.every(r=>r.closed));
});
