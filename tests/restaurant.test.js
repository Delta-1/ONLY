import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store,hash} from '../lib/store.js';
import {defaults,initialState,mutate,workspace,diningPublic,diningPublicOrder} from '../supabase/functions/only/domain.js';

for(const backend of ['cloud','sqlite'])test(`${backend}: restaurant tabs, scoped QR access, reservations, payment and register lifecycle`,()=>{
 const dir=backend==='sqlite'?mkdtempSync(join(tmpdir(),'only-tables-')):null,db=dir?new Store(dir):null;
 const user=db?db.signup({name:'Owner',businessName:'Restaurant QA',email:'tables@example.test',password:'test-tables-123'}).user:{id:crypto.randomUUID(),business:crypto.randomUUID(),name:'Owner',role:'owner'};
 const state=initialState({...defaults,id:user.business}),b=user.business;
 const read=()=>db?db.workspace(user):workspace(state,user);
 const call=(path,body)=>{
  if(!db){const raw=crypto.randomUUID();return mutate(state,user,path,body,{linkToken:raw,linkHash:hash(raw),linkCode:crypto.randomUUID(),closePinVerified:true});}
  if(path==='/api/settings')return db.saveSettings(b,body);
  if(path==='/api/products')return db.saveProduct(b,body,body.id);
  if(path==='/api/registers/open')return db.openRegister(b,user,body);
  if(path==='/api/registers/close')return db.closeRegister(b,{...body,pin:'1234'});
  if(path==='/api/sales')return db.completeSale(b,user,body);
  return db.diningChange(b,user,path,body);
 };
 const view=(kind,key)=>db?db.diningPublicView(key,kind):diningPublic(state,key,kind,hash(key));
 const order=(kind,key,body)=>db?db.diningPublicOrder(key,kind,body):diningPublicOrder(state,key,kind,body,hash(key));
 const settings={...defaults,name:'Restaurant QA',commerceType:'restaurant',restaurantEnabled:true,tableCount:2,tableCustomerMode:'menu',tableQrColor:'#128a65'};
 try{
  assert.equal(read().restaurant,null);
  call('/api/settings',settings);const [one,two]=read().restaurant.tables;
  assert.equal(one.code,'01');assert.equal(two.code,'02');assert.equal(read().business.restaurantState,undefined);
  const p=call('/api/products',{name:'Lunch',code:'LUNCH',prices:{BRL:10},stock:10}),reg=call('/api/registers/open',{name:'Lunch register',currency:'BRL',opening:50});
  const waiter=call('/api/restaurant/links',{kind:'waiter',registerId:reg.id}),qr=call('/api/restaurant/links',{kind:'table',tableId:one.id,registerId:reg.id});
  assert.equal(call('/api/restaurant/links',{kind:'table',tableId:one.id,registerId:reg.id}).token,qr.token,'printed links stay stable');
  assert.equal(view('table',qr.token).restaurant.canOrder,false);assert.equal(view('table',qr.token).restaurant.tables.length,1);assert.equal(view('table',qr.token).users,undefined);
  const first={requestId:crypto.randomUUID(),currency:'BRL',tableId:one.id,waiter:'João',items:[{id:p.id,quantity:2}]};
  assert.throws(()=>order('table',qr.token,first),/menuOnly/);
  const a=order('waiter',waiter.token,first);assert.equal(order('waiter',waiter.token,first).id,a.id);
  let tab=read().restaurant.tables[0].tab;assert.equal(tab.total,2000);assert.equal(read().products[0].stock,10);assert.equal(view('waiter',waiter.token).products[0].stock,8);
  assert.throws(()=>call('/api/settings',{...settings,restaurantEnabled:false}),/openTabs/);
  call('/api/settings',{...settings,tableCustomerMode:'order'});
  const guest={requestId:crypto.randomUUID(),currency:'BRL',tableId:one.id,items:[{id:p.id,quantity:1}]};
  assert.throws(()=>order('table',qr.token,{...guest,tableId:two.id}),/forbidden/);
  assert.throws(()=>order('table',qr.token,{...guest,currency:'USD'}),/registerCurrency/);
  order('table',qr.token,guest);assert.equal(read().restaurant.tables[0].tab.id,tab.id);assert.equal(read().restaurant.tables[0].tab.total,3000);
  assert.equal(view('table',qr.token).restaurant.tables[0].tab.orders,undefined,'guest does not see staff identity or notes');
  const second=order('waiter',waiter.token,{...first,requestId:crypto.randomUUID(),tableId:two.id});
  assert.equal(read().restaurant.tables[1].tab.total,2000);
  assert.throws(()=>call('/api/settings',{...settings,tableCount:1}),/openTabs/);
  assert.throws(()=>call('/api/registers/close',{id:reg.id,counted:50}),/openTabs/);
  const sale={requestId:crypto.randomUUID(),registerId:reg.id,currency:'BRL',method:'cash',received:100,items:[{id:p.id,quantity:6}]};
  assert.throws(()=>call('/api/sales',sale),/insufficientStock/);
  call('/api/sales',{...sale,items:[{id:p.id,quantity:1}]});
  assert.throws(()=>call('/api/products',{...p,prices:{BRL:10},stock:2}),/insufficientStock/);
  call('/api/products',{...p,name:'Lunch renamed',code:'LUNCH-2',prices:{BRL:20},stock:9});
  const stale=read().restaurant.tables[0].tab;
  order('waiter',waiter.token,{...first,requestId:crypto.randomUUID(),items:[{id:p.id,quantity:1}]});
  tab=read().restaurant.tables[0].tab;assert.equal(tab.total,5000,'previous orders keep their server-recorded prices');
  const payment={requestId:crypto.randomUUID(),tabId:tab.id,tabRevision:stale.revision,registerId:reg.id,currency:'BRL',method:'cash',received:60,items:[{id:p.id,quantity:999,price:0}]};
  assert.throws(()=>call('/api/sales',payment),/concurrentUpdate/);
  payment.tabRevision=tab.revision;const paid=call('/api/sales',payment);
  assert.equal(paid.total,5000);assert.equal(paid.change,1000);assert.equal(paid.tabId,tab.id);
  assert.equal(read().products[0].stock,5);assert.equal(read().restaurant.tables[0].tab,null);assert.equal(read().restaurant.tables[1].tab.total,2000);
  assert.equal(read().registers.find(r=>r.id===reg.id).expected,11000);
  assert.equal(call('/api/sales',payment).id,paid.id);assert.equal(read().products[0].stock,5,'payment retries do not duplicate a sale');
  const next=order('table',qr.token,{...guest,requestId:crypto.randomUUID()});assert.notEqual(next.tabId,tab.id,'next visit gets a new tab');
  call('/api/orders/status',{id:second.id,status:'cancelled'});call('/api/orders/status',{id:next.id,status:'cancelled'});
  assert.equal(read().restaurant.tables.every(t=>!t.tab),true);
  call('/api/registers/close',{id:reg.id,counted:110});assert.throws(()=>view('waiter',waiter.token),/registerClosed/);
  assert.equal(view('table',qr.token).restaurant.canOrder,false,'printed menu survives register closure');
  const evening=call('/api/registers/open',{name:'Evening',currency:'BRL',opening:0});call('/api/restaurant/links',{kind:'waiter',registerId:evening.id});
  assert.equal(view('table',qr.token).restaurant.canOrder,true,'same printed QR works in the next service');
  if(db){const reopened=new Store(dir);try{assert.equal(reopened.workspace(user).restaurant.tables.length,2);assert.equal(reopened.diningPublicView(qr.token,'table').restaurant.canOrder,true);}finally{reopened.db.close();}}
  call('/api/settings',{...settings,restaurantEnabled:false});assert.equal(read().restaurant,null);assert.throws(()=>view('table',qr.token),/restaurantDisabled/);
 }finally{if(db)db.db.close();if(dir)rmSync(dir,{recursive:true,force:true});}
});

test('cloud gateway: simultaneous waiter devices append to one tab after a version conflict',async()=>{
 const {createHandler,digest}=await import('../supabase/functions/only/handler.js');
 const user={id:crypto.randomUUID(),business:crypto.randomUUID(),name:'Owner',role:'owner'},state=initialState({...defaults,id:user.business});
 mutate(state,user,'/api/settings',{...defaults,name:'Concurrent QA',commerceType:'restaurant',restaurantEnabled:true,tableCount:2,tableCustomerMode:'menu'});
 const p=mutate(state,user,'/api/products',{name:'Coffee',prices:{BRL:5},stock:10}),r=mutate(state,user,'/api/registers/open',{name:'Cash',currency:'BRL'}),raw=crypto.randomUUID();
 mutate(state,user,'/api/restaurant/links',{kind:'waiter',registerId:r.id},{linkToken:raw,linkHash:await digest(raw),linkCode:'WAITER'});
 let saved=state,version=1,conflicts=0,reads=0,releaseReads;const readGate=new Promise(resolve=>{releaseReads=resolve;});
 const handler=createHandler({qr:async()=>'',rpc:async(op,data)=>{
  if(op==='rate_limit')return {allowed:true};
  if(op==='read_workspace'){const row={id:user.business,version,body:structuredClone(saved)};if(reads<2){reads++;if(reads===2)releaseReads();await readGate;}return row;}
  if(op==='write_workspace'){if(data.version!==version){conflicts++;return {updated:false};}saved=structuredClone(data.body);version++;return {updated:true};}
  throw Error('Unexpected operation '+op);
 }});
 const send=name=>handler(new Request(`https://test.invalid/functions/v1/only/api/public/waiter/${raw}/order`,{method:'POST',headers:{'Content-Type':'application/json','X-Only-Request':'1'},body:JSON.stringify({requestId:crypto.randomUUID(),tableId:state.restaurant.tables[0].id,currency:'BRL',waiter:name,items:[{id:p.id,quantity:1}]})}));
 const responses=await Promise.all([send('Waiter A'),send('Waiter B')]);assert.deepEqual(responses.map(r=>r.status),[201,201]);
 assert.ok(conflicts>=1);assert.equal(saved.restaurant.tabs.length,1);assert.equal(saved.orders.length,2);assert.equal(saved.restaurant.tabs[0].revision,2);assert.equal(workspace(saved,user).restaurant.tables[0].tab.total,1000);
});
