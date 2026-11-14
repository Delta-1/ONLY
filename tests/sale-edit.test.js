import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../lib/store.js';
import { defaults, initialState, mutate, workspace } from '../supabase/functions/only/domain.js';

for (const backend of ['cloud', 'sqlite']) test(`${backend}: atomic sale correction preserves identity, stock, cash and audit`, () => {
  const dir = backend === 'sqlite' ? mkdtempSync(join(tmpdir(), 'only-edit-')) : null;
  const db = dir ? new Store(dir) : null;
  const u = db ? db.signup({ email:'edit@example.test', password:'edit-test-123', name:'Admin', businessName:'Edit QA' }).user : { id:crypto.randomUUID(), business:crypto.randomUUID(), role:'owner', name:'Admin' };
  const b = u.business, state = initialState({...defaults, id:b});
  const call = (path, body, user=u) => {
    if (!db) return mutate(state,user,path,body);
    if (path === '/api/products') return db.saveProduct(b,body);
    if (path === '/api/registers/open') return db.openRegister(b,user,body);
    if (path === '/api/sales') return db.completeSale(b,user,body);
    if (path === '/api/sales/edit') return db.editSale(b,user,body);
    if (path === '/api/sales/cancel') return db.cancel(b,body.id);
    if (path === '/api/registers/close') return db.closeRegister(b,body);
  };
  const read = () => db ? db.workspace(u) : workspace(state,u);
  try {
    const p = call('/api/products',{name:'Original',code:'ONE',prices:{BRL:10},stock:10});
    const q = call('/api/products',{name:'Added',code:'TWO',prices:{BRL:5},stock:5});
    const r = call('/api/registers/open',{name:'Caixa',currency:'BRL',opening:50});
    const sale = structuredClone(call('/api/sales',{requestId:crypto.randomUUID(),registerId:r.id,currency:'BRL',method:'cash',received:20,items:[{id:p.id,quantity:2}]}));
    const edit = {id:sale.id,revision:0,requestId:crypto.randomUUID(),reason:'Correct items',items:[{id:p.id,quantity:3,price:9},{id:q.id,quantity:1,price:5}],discount:2,method:'cash',received:40};
    const revised = structuredClone(call('/api/sales/edit',edit));
    assert.equal(revised.id,sale.id);assert.equal(revised.number,sale.number);assert.equal(revised.date,sale.date);
    assert.equal(revised.total,3000);assert.equal(revised.change,1000);assert.equal(revised.revision,1);
    assert.equal(revised.history[0].previous.total,2000);assert.equal(revised.history[0].reason,'Correct items');
    let w=read();assert.equal(w.products.find(v=>v.id===p.id).stock,7);assert.equal(w.products.find(v=>v.id===q.id).stock,4);assert.equal(w.registers[0].expected,8000);
    call('/api/sales/edit',edit);assert.equal(read().sales[0].history.length,1);assert.equal(read().products.find(v=>v.id===p.id).stock,7);
    const before=JSON.stringify(read());
    for(const [body,error] of [[{...edit,requestId:crypto.randomUUID()},/concurrentUpdate/],[{...edit,revision:1,requestId:crypto.randomUUID(),received:1000,items:[{id:p.id,quantity:99,price:9}]},/insufficientStock/],[{...edit,revision:1,requestId:crypto.randomUUID(),items:[{id:p.id,quantity:1,price:-1}]},/invalidAmount/],[{...edit,revision:1,requestId:crypto.randomUUID(),items:[]},/emptyCart/]]) {
      assert.throws(()=>call('/api/sales/edit',body),error);assert.equal(JSON.stringify(read()),before,'failed edit changes nothing');
    }
    assert.throws(()=>call('/api/sales/edit',{...edit,revision:1,requestId:crypto.randomUUID()},{...u,role:'cashier'}),/forbidden/);
    call('/api/sales/edit',{...edit,revision:1,requestId:crypto.randomUUID(),method:'card',received:30});
    assert.equal(read().registers[0].expected,5000,'switching from cash removes its prior cash contribution');
    call('/api/sales/cancel',{id:sale.id});w=read();assert.equal(w.products.find(v=>v.id===p.id).stock,10);assert.equal(w.products.find(v=>v.id===q.id).stock,5);
    assert.throws(()=>call('/api/sales/edit',{...edit,revision:2,requestId:crypto.randomUUID()}),/saleCancelled/);
    const later=call('/api/sales',{requestId:crypto.randomUUID(),registerId:r.id,currency:'BRL',method:'cash',received:10,items:[{id:p.id,quantity:1}]});
    if(db)db.closeRegister(b,{id:r.id,counted:60,pin:'1234'});else mutate(state,u,'/api/registers/close',{id:r.id,counted:60},{closePinVerified:true});
    assert.throws(()=>call('/api/sales/edit',{...edit,id:later.id,requestId:crypto.randomUUID()}),/registerClosed/);
  } finally { if(db)db.db.close();if(dir)rmSync(dir,{recursive:true,force:true}); }
});

test('cloud: sale edits respect tenant ownership and already received customer balances',()=>{
 const u={id:crypto.randomUUID(),business:crypto.randomUUID(),role:'owner',name:'Admin'},s=initialState({...defaults,id:u.business});
 const p=mutate(s,u,'/api/products',{name:'Item',prices:{BRL:10},stock:10}),r=mutate(s,u,'/api/registers/open',{name:'Caixa',currency:'BRL'}),c=mutate(s,u,'/api/clients',{name:'Customer'});
 const sale=mutate(s,u,'/api/sales',{requestId:crypto.randomUUID(),registerId:r.id,currency:'BRL',method:'credit',clientId:c.id,items:[{id:p.id,quantity:1}]});
 const edit={id:sale.id,revision:0,requestId:crypto.randomUUID(),reason:'Correction',items:[{id:p.id,quantity:1,price:10}],method:'credit',clientId:c.id};
 assert.throws(()=>mutate(initialState({...defaults,id:crypto.randomUUID()}),u,'/api/sales/edit',edit),/notFound/);
 mutate(s,u,'/api/receipts',{clientId:c.id,registerId:r.id,currency:'BRL',amount:5,method:'cash'});
 const before=JSON.stringify(s);assert.throws(()=>mutate(s,u,'/api/sales/edit',edit),/saleHasReceipts/);assert.equal(JSON.stringify(s),before);
});
