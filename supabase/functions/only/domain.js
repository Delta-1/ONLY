import {currencies,cents,cashTenderSummary} from './money.js';
export const defaults={name:'Minha empresa',currency:'BRL',language:'pt',logo:'',theme:'dark',layout:'clean',showCatalog:true,soundEffects:true,saleAnimations:true,menuPosition:'top',phone:'',address:'',taxId:'',storeEnabled:false,storeDescription:'',minOrder:0};
export const publicBusiness=({closePinHash,restaurantState,...business})=>business;
export const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export const text=(v,max=200)=>String(v??'').trim().slice(0,max);
export const id=()=>crypto.randomUUID();
export const now=()=>new Date().toISOString();
export const hex=(n=24)=>Array.from(crypto.getRandomValues(new Uint8Array(n)),x=>x.toString(16).padStart(2,'0')).join('');
export const amount=v=>{const n=Number(v);if(!Number.isFinite(n)||n<0||n>1e9)fail('invalidAmount');return cents(n);};
export const qty=v=>{const n=Number(v);if(!Number.isFinite(n)||n<0||n>1e7)fail('invalidQuantity');return Math.round(n*1000)/1000;};
export const currency=v=>currencies.includes(v)?v:fail('invalidCurrency');
export const image=v=>{if(!v)return '';if(typeof v!=='string'||v.length>700000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v))fail('invalidImage');return v;};
export const owner=u=>{if(u?.role!=='owner')fail('forbidden',403);};
export function initialState(business){return {business,products:[],clients:[],registers:[],movements:[],sales:[],orders:[],drafts:[],links:[],receipts:[]};}
export function product(s,key){const p=s.products.find(p=>p.id===key);if(!p)fail('notFound',404);return p;}
export function normalizeProduct(body,key=id()){
 const name=text(body.name),code=text(body.code||`P-${hex(4)}`,80);if(!name)fail('required');const prices={},wholesale={};
 for(const c of currencies){if(body.prices?.[c]!==''&&body.prices?.[c]!=null)prices[c]=amount(body.prices[c]);if(body.wholesale?.[c]!==''&&body.wholesale?.[c]!=null)wholesale[c]=amount(body.wholesale[c]);}
 if(!Object.keys(prices).length)fail('priceRequired');
 return {id:key,name,code,category:text(body.category,80),description:text(body.description,1000),unit:text(body.unit||'un',20),image:image(body.image),prices,wholesale,cost:amount(body.cost||0),costCurrency:currency(body.costCurrency||'BRL'),stock:qty(body.stock||0),minStock:qty(body.minStock||0),trackStock:body.trackStock!==false,published:body.published!==false,active:body.active!==false};
}
function writeProduct(s,p){if(s.products.some(x=>x.code===p.code&&x.id!==p.id))fail('duplicateCode',409);const at=s.products.findIndex(x=>x.id===p.id);if(at<0)s.products.push(p);else s.products[at]=p;return p;}
export function openRegister(s,key,u){const r=s.registers.find(r=>r.id===key&&!r.closed);if(!r)fail('openRegisterRequired');if(u&&u.role!=='owner'&&r.user!==u.id)fail('forbidden',403);return r;}
export function expected(s,r){return r.opening+s.sales.filter(v=>v.registerId===r.id&&v.status!=='cancelled'&&v.method==='cash').reduce((n,v)=>n+v.paid,0)+s.receipts.filter(v=>v.registerId===r.id&&v.method==='cash').reduce((n,v)=>n+v.amount,0)+s.movements.filter(v=>v.registerId===r.id).reduce((n,v)=>n+(v.kind==='in'?v.amount:-v.amount),0);}
export function priceItems(s,b,publicMode=false){currency(b.currency);if(!Array.isArray(b.items)||!b.items.length||b.items.length>200)fail('emptyCart');const combined=new Map();for(const i of b.items){if(!i||typeof i.id!=='string')fail('invalidQuantity');const q=qty(i.quantity);if(!q)fail('invalidQuantity');combined.set(i.id,(combined.get(i.id)||0)+q);}
 return [...combined].map(([key,q])=>{const p=product(s,key);if(!p.active||(publicMode&&!p.published))fail('unavailableProduct');const price=!publicMode&&b.wholesale?p.wholesale[b.currency]??p.prices[b.currency]:p.prices[b.currency];if(price==null)fail('priceUnavailable');if(p.trackStock&&q>p.stock-reservedQuantity(s,key))fail('insufficientStock');const total=Math.round(price*q);if(!Number.isSafeInteger(total))fail('invalidAmount');return {id:key,code:p.code,name:p.name,quantity:qty(q),price,total};});
}
export function balance(s,client,c){return s.sales.filter(v=>v.client?.id===client&&v.currency===c&&v.status!=='cancelled').reduce((n,v)=>n+v.due,0)-s.receipts.filter(v=>v.client===client&&v.currency===c).reduce((n,v)=>n+v.amount,0);}
export function workspace(s,u,users=[]){const result=structuredClone(s);delete result.links;result.business=publicBusiness(result.business);result.user=u;result.users=u.role==='owner'?users:[];result.links=u.role==='owner'?s.links.map(({code,kind,expires,active})=>({code,kind,expires,active})):[];result.drafts=u.role==='owner'?result.drafts:[];
 result.capabilities={saleEditing:true,restaurant:true};result.restaurant=diningWorkspace(s,u);
 result.products.sort((a,b)=>a.code.localeCompare(b.code));result.clients=result.clients.map(c=>({...c,balances:Object.fromEntries(currencies.map(code=>[code,balance(s,c.id,code)]))}));result.registers=result.registers.map(r=>({...r,expected:r.closed?r.expected:expected(s,r)})).sort((a,b)=>b.opened.localeCompare(a.opened));
 const credits=new Map();for(const r of s.receipts){const k=`${r.client}:${r.currency}`;credits.set(k,(credits.get(k)||0)+r.amount);}
 for(const sale of [...result.sales].sort((a,b)=>a.date.localeCompare(b.date))){const k=`${sale.client?.id}:${sale.currency}`,credit=credits.get(k)||0,applied=sale.status==='cancelled'?0:Math.min(sale.due,credit);sale.outstanding=sale.status==='cancelled'?0:sale.due-applied;credits.set(k,credit-applied);}
 for(const name of ['sales','orders','movements','receipts'])result[name].sort((a,b)=>b.date.localeCompare(a.date));
 return result;
}
export function resolveLink(s,key,kind,keyHash){const l=s.links.find(l=>l.kind===kind&&(l.token===keyHash||(kind==='mobile'&&l.code===key.toUpperCase()))&&l.active&&l.expires>Date.now());if(!l)fail('expiredLink',404);return l;}
export function publicCatalog(s,key,kind,keyHash){if(kind==='store'){if(s.business.code!==key.toUpperCase())fail('notFound',404);if(!s.business.storeEnabled)fail('storeDisabled',404);}else resolveLink(s,key,kind,keyHash);
 const {name,logo,currency,language,theme,storeDescription,minOrder}=s.business;return {business:{name,logo,currency,language,theme,storeDescription,minOrder},...(kind==='collaborate'?{}:{products:s.products.filter(p=>p.active&&p.published).map(({id,name,code,category,description,image,prices,stock,trackStock,unit})=>({id,name,code,category,description,image,prices,stock,trackStock,unit}))})};
}
export function publicMutation(s,key,kind,action,b,keyHash){publicCatalog(s,key,kind,keyHash);if(action==='draft'&&kind==='collaborate'){const p=normalizeProduct(b);s.drafts.push(p);return {id:p.id};}
 if(action!=='order'||kind==='collaborate')fail('notFound',404);const requestId=text(b.requestId,100);if(requestId.length<12)fail('requestIdRequired');const old=s.orders.find(o=>o.requestId===requestId);if(old)return {id:old.id,number:old.number,status:old.status};if(!text(b.customer)||!text(b.phone))fail('required');const items=priceItems(s,b,true),total=items.reduce((n,i)=>n+i.total,0);if(b.currency!==s.business.currency)fail('invalidCurrency');if(total<s.business.minOrder)fail('minimumOrder');const keyId=id(),o={id:keyId,number:`P-${keyId.slice(0,8).toUpperCase()}`,date:now(),items,total,currency:b.currency,customer:text(b.customer),phone:text(b.phone,60),address:text(b.address),table:text(b.table,60),notes:text(b.notes,1000),channel:kind,status:'new',requestId};s.orders.push(o);return {id:o.id,number:o.number,status:o.status};
}
export function mutate(s,u,path,b,context={}){
 if(path==='/api/sales/edit')return reviseSale(s,u,b);
 if(path.startsWith('/api/restaurant/'))return diningMutation(s,u,path,b,context);
 if(['/api/settings','/api/products','/api/links','/api/links/revoke','/api/drafts/approve','/api/drafts/reject','/api/sales/cancel'].includes(path))owner(u);
 if(path==='/api/settings'){const old=s.business,next={...old,name:text(b.name),currency:currency(b.currency),language:['pt','es','en'].includes(b.language)?b.language:'pt',theme:b.theme==='light'?'light':'dark',layout:b.layout==='classic'?'classic':'clean',menuPosition:b.menuPosition==='side'?'side':'top',showCatalog:b.showCatalog!==false,soundEffects:(b.soundEffects??old.soundEffects)!==false,saleAnimations:(b.saleAnimations??old.saleAnimations)!==false,...(context.closePinHash?{closePinHash:context.closePinHash}:{}),logo:image(b.logo),phone:text(b.phone,50),address:text(b.address),taxId:text(b.taxId,50),storeEnabled:Boolean(b.storeEnabled),storeDescription:text(b.storeDescription,1000),minOrder:amount(b.minOrder||0)};if(!next.name)fail('required');const configuration=configureDining(s,b);s.business={...next,...configuration};return publicBusiness(s.business);}
 if(path==='/api/products'){if(b.id)product(s,b.id);const p=normalizeProduct(b,b.id);if(p.trackStock&&p.stock<reservedQuantity(s,p.id))fail('insufficientStock');return writeProduct(s,p);}
 if(path==='/api/clients'){const name=text(b.name);if(!name)fail('required');if(b.id&&!s.clients.some(c=>c.id===b.id))fail('notFound',404);const c={id:b.id||id(),name,phone:text(b.phone,60),address:text(b.address),taxId:text(b.taxId,60)},at=s.clients.findIndex(c2=>c2.id===c.id);if(at<0)s.clients.push(c);else s.clients[at]=c;return c;}
 if(path==='/api/registers/open'){const name=text(b.name,80);if(!name)fail('required');if(s.registers.some(r=>r.name===name&&!r.closed))fail('registerAlreadyOpen',409);const r={id:id(),name,business:s.business.id,user:u.id,opened:now(),closed:null,currency:currency(b.currency),opening:amount(b.opening||0)};s.registers.push(r);return r;}
 if(path==='/api/registers/close'){assertNoOpenTabs(s,b.id);const r=openRegister(s,b.id,u);if(!context.closePinVerified)fail('invalidClosingPin',403);r.expected=expected(s,r);r.counted=amount(b.counted);r.closed=now();return {...r,difference:r.counted-r.expected};}
 if(path==='/api/movements'){const r=openRegister(s,b.registerId,u),value=amount(b.amount),note=text(b.note);if(!value||!note||!['in','out'].includes(b.kind))fail('required');const m={id:id(),date:now(),registerId:r.id,kind:b.kind,amount:value,note};s.movements.push(m);return m;}
 if(path==='/api/sales'){
  const requestId=text(b.requestId,100);if(requestId.length<12)fail('requestIdRequired');const previous=s.sales.find(v=>v.requestId===requestId);if(previous)return previous;
  const r=openRegister(s,b.registerId,u);if(r.currency!==b.currency)fail('registerCurrency');const dining=b.tabId?prepareTabSale(s,u,b):null,items=dining?dining.items:priceItems(s,b),subtotal=items.reduce((n,i)=>n+i.total,0),discount=amount(b.discount||0);if(discount>subtotal)fail('invalidDiscount');const total=subtotal-discount,method=b.method;if(!['cash','pix','qr','card','transfer','credit'].includes(method))fail('invalidPayment');const client=b.clientId?s.clients.find(c=>c.id===b.clientId):null;if(b.clientId&&!client)fail('notFound',404);const tender=cashTenderSummary(total/100,method==='credit'?0:b.received??total/100);if(!tender.valid)fail('invalidAmount');if(tender.remaining&&!client)fail('clientRequired');if(tender.remaining&&!b.allowPartial&&method!=='credit')fail('insufficientPayment');if(method!=='cash'&&tender.change)fail('nonCashOverpayment');const order=b.orderId?s.orders.find(o=>o.id===b.orderId):null;if(b.orderId&&(!order||order.tabId||!['new','accepted'].includes(order.status)))fail('orderAlreadyProcessed',409);
  const saleId=id(),date=now(),paid=Math.min(cents(tender.received),total),sale={id:saleId,number:`V-${date.slice(0,10).replaceAll('-','')}-${saleId.slice(0,6).toUpperCase()}`,date,items,subtotal,discount,total,currency:b.currency,method,received:cents(tender.received),change:cents(tender.change),paid,due:total-paid,client:client?structuredClone(client):null,registerId:r.id,registerName:r.name,seller:u.name,status:'completed',notes:text(b.notes,1000),orderId:order?.id||null,requestId};
  for(const i of items){const p=product(s,i.id);if(p.trackStock)p.stock=qty(p.stock-i.quantity);}s.sales.push(sale);if(dining)finishTabSale(s,dining.tab,sale);if(order)order.status='completed';return sale;
 }
 if(path==='/api/sales/cancel'){const sale=s.sales.find(v=>v.id===b.id);if(!sale)fail('notFound',404);if(sale.status==='cancelled')return sale;if(!s.registers.some(r=>r.id===sale.registerId&&!r.closed))fail('registerClosed');if(s.receipts.some(r=>r.client===sale.client?.id&&r.currency===sale.currency))fail('saleHasReceipts');for(const i of sale.items){const p=product(s,i.id);if(p.trackStock)p.stock=qty(p.stock+i.quantity);}sale.status='cancelled';return sale;}
 if(path==='/api/receipts'){const c=currency(b.currency),value=amount(b.amount),client=s.clients.find(c=>c.id===b.clientId);if(!client)fail('notFound',404);if(!value||value>balance(s,client.id,c))fail('invalidAmount');if(!['cash','pix','qr','card','transfer'].includes(b.method))fail('invalidPayment');const r=openRegister(s,b.registerId,u);if(r.currency!==c)fail('registerCurrency');const entry={id:id(),date:now(),client:client.id,currency:c,amount:value,method:b.method,registerId:r.id};s.receipts.push(entry);return {id:entry.id};}
 if(path==='/api/links'){if(!['mobile','collaborate'].includes(b.kind))fail('invalidLink');const l={token:context.linkHash,code:context.linkCode,kind:b.kind,active:1,expires:Date.now()+(b.kind==='collaborate'?7:30)*86400000};if(!l.token||!l.code)fail('invalidLink');s.links.push(l);return {token:context.linkToken,code:l.code,kind:l.kind,expires:l.expires};}
 if(path==='/api/links/revoke'){const l=s.links.find(l=>l.code===b.code);if(l)l.active=0;return {ok:true};}
 if(path==='/api/drafts/approve'){const p=s.drafts.find(d=>d.id===b.id);if(!p)fail('notFound',404);writeProduct(s,p);s.drafts=s.drafts.filter(d=>d.id!==b.id);return p;}
 if(path==='/api/drafts/reject'){s.drafts=s.drafts.filter(d=>d.id!==b.id);return {ok:true};}
 if(path==='/api/orders/status'){if(!['accepted','cancelled'].includes(b.status))fail('invalidStatus');const o=s.orders.find(o=>o.id===b.id);if(!o)fail('notFound',404);if(['completed','cancelled'].includes(o.status))fail('orderAlreadyProcessed',409);if(o.tabId){const tab=s.restaurant?.tabs.find(t=>t.id===o.tabId&&t.status==='open');if(!tab)fail('tabClosed',409);tab.revision++;if(b.status==='cancelled'&&!s.orders.some(other=>other.id!==o.id&&other.tabId===tab.id&&['new','accepted'].includes(other.status)))tab.status='cancelled';}o.status=b.status;return {ok:true};}
 fail('notFound',404);
}

// Validate the entire correction before applying stock or sale changes. The
// caller commits this state atomically (SQLite transaction / workspace CAS).
export function reviseSale(s,u,b){
 owner(u);
 const sale=s.sales.find(v=>v.id===b.id);
 if(!sale)fail('notFound',404);
 const requestId=text(b.requestId,100);
 if(requestId.length<12)fail('requestIdRequired');
 if(sale.lastEditRequestId===requestId)return sale;
 if(sale.status==='cancelled')fail('saleCancelled');
 if(b.revision!==(sale.revision||0))fail('concurrentUpdate',409);
 if(!s.registers.some(r=>r.id===sale.registerId&&!r.closed))fail('registerClosed');
 if(s.receipts.some(r=>r.client===sale.client?.id&&r.currency===sale.currency))fail('saleHasReceipts');
 const reason=text(b.reason,500);
 if(!reason)fail('required');
 if(!Array.isArray(b.items)||!b.items.length||b.items.length>200)fail('emptyCart');
 const seen=new Set(),items=b.items.map(i=>{
  if(!i||seen.has(i.id))fail('invalidQuantity');seen.add(i.id);
  const p=product(s,i.id),quantity=qty(i.quantity),price=amount(i.price);
  if(!quantity)fail('invalidQuantity');
  if(!p.active&&!sale.items.some(old=>old.id===p.id))fail('unavailableProduct');
  return {id:p.id,code:p.code,name:p.name,quantity,price,total:Math.round(quantity*price)};
 });
 const subtotal=items.reduce((n,i)=>n+i.total,0),discount=amount(b.discount||0);
 if(!Number.isSafeInteger(subtotal))fail('invalidAmount');
 if(discount>subtotal)fail('invalidDiscount');
 const total=subtotal-discount,method=b.method;
 if(!['cash','pix','qr','card','transfer','credit'].includes(method))fail('invalidPayment');
 const client=b.clientId?s.clients.find(c=>c.id===b.clientId):null;
 if(b.clientId&&!client)fail('notFound',404);
 if(client&&s.receipts.some(r=>r.client===client.id&&r.currency===sale.currency))fail('saleHasReceipts');
 const tender=cashTenderSummary(total/100,method==='credit'?0:b.received??total/100);
 if(!tender.valid)fail('invalidAmount');
 if(tender.remaining&&!client)fail('clientRequired');
 if(tender.remaining&&b.allowPartial!==true&&method!=='credit')fail('insufficientPayment');
 if(method!=='cash'&&tender.change)fail('nonCashOverpayment');
 const changes=[];
 for(const key of new Set([...sale.items,...items].map(i=>i.id))){
  const p=product(s,key);
  if(p.trackStock){
   const old=sale.items.filter(i=>i.id===key).reduce((n,i)=>n+i.quantity,0),next=items.filter(i=>i.id===key).reduce((n,i)=>n+i.quantity,0);
   const stock=Math.round((p.stock+old-next)*1000)/1000;
   if(stock<reservedQuantity(s,key))fail('insufficientStock');changes.push([p,qty(stock)]);
  }
 }
 const {history=[],outstanding,...previous}=structuredClone(sale),at=now(),paid=Math.min(cents(tender.received),total);
 const revised={...previous,items,subtotal,discount,total,method,received:cents(tender.received),change:cents(tender.change),paid,due:total-paid,client:client?structuredClone(client):null,notes:text(b.notes,1000),revision:(sale.revision||0)+1,lastEditRequestId:requestId,editedAt:at,history:[...history,{at,user:u.id,name:u.name,reason,previous}]};
 for(const [p,stock] of changes)p.stock=stock;
 Object.assign(sale,revised);
 delete sale.outstanding;
 return sale;
}

export const diningEnabled = b => b.restaurantEnabled === true && ['restaurant','bar','cafe'].includes(b.commerceType);
export function configureDining(s,b){
 const old=s.business,next={commerceType:['retail','restaurant','bar','cafe'].includes(b.commerceType)?b.commerceType:old.commerceType||'retail',restaurantEnabled:(b.restaurantEnabled??old.restaurantEnabled)===true,tableCount:Number(b.tableCount??old.tableCount??12),tableCustomerMode:(b.tableCustomerMode??old.tableCustomerMode)==='order'?'order':'menu',tableQrColor:b.tableQrColor??old.tableQrColor??'#7c3aed'};
 if(!Number.isInteger(next.tableCount)||next.tableCount<1||next.tableCount>200)fail('invalidTables');
 if(!/^#[0-9a-f]{6}$/i.test(next.tableQrColor))fail('invalidColor');
 const active=(s.restaurant?.tabs||[]).filter(t=>t.status==='open');
 if(active.length&&(!diningEnabled(next)||active.some(t=>Number(t.tableCode)>next.tableCount)))fail('openTabs');
 if(!diningEnabled(next))next.restaurantEnabled=false;
 Object.assign(s.business,next);
 if(diningEnabled(next)){
  s.restaurant??={tables:[],tabs:[],serviceRegisterId:''};
  for(let n=1;n<=next.tableCount;n++)if(!s.restaurant.tables.some(t=>t.code===String(n).padStart(2,'0')))s.restaurant.tables.push({id:id(),code:String(n).padStart(2,'0')});
 }
 return next;
}
export const diningTables=s=>(s.restaurant?.tables||[]).filter(t=>Number(t.code)<=s.business.tableCount);
export function reservedQuantity(s,key,exceptTab=''){
 const open=new Set((s.restaurant?.tabs||[]).filter(t=>t.status==='open'&&t.id!==exceptTab).map(t=>t.id));
 return s.orders.filter(o=>open.has(o.tabId)&&['new','accepted'].includes(o.status)).reduce((n,o)=>n+o.items.filter(i=>i.id===key).reduce((m,i)=>m+i.quantity,0),0);
}
function diningRequired(s){if(!diningEnabled(s.business))fail('restaurantDisabled',403);}
function diningTable(s,key){const table=diningTables(s).find(t=>t.id===key);if(!table)fail('notFound',404);return table;}
function openTab(s,tableId){return (s.restaurant?.tabs||[]).find(t=>t.tableId===tableId&&t.status==='open');}
export function tabSummary(s,tab){
 if(!tab)return null;
 const orders=s.orders.filter(o=>o.tabId===tab.id&&['new','accepted'].includes(o.status));
 const items=orders.flatMap(o=>o.items.map(i=>({...i,orderId:o.id})));
 return {id:tab.id,tableId:tab.tableId,tableCode:tab.tableCode,registerId:tab.registerId,currency:tab.currency,revision:tab.revision,status:tab.status,opened:tab.opened,items,total:items.reduce((n,i)=>n+i.total,0),orders:orders.map(o=>({id:o.id,number:o.number,items:o.items,total:o.total,notes:o.notes,waiter:o.waiter,date:o.date,status:o.status}))};
}
function tableViews(s){return diningTables(s).map(t=>({...t,tab:tabSummary(s,openTab(s,t.id))}));}
export function diningWorkspace(s,u){
 if(!diningEnabled(s.business))return null;
 return {tables:tableViews(s),links:s.links.filter(l=>['table','waiter'].includes(l.kind)&&l.active&&l.expires>Date.now()&&(l.kind==='table'||s.registers.some(r=>r.id===l.registerId&&!r.closed&&(u.role==='owner'||r.user===u.id)))).map(({raw,kind,tableId,registerId,code,expires})=>({token:raw,kind,tableId,registerId,code,expires}))};
}
export function diningPublic(s,key,kind,keyHash){
 diningRequired(s);
 const link=resolveLink(s,key,kind,keyHash),boundTab=kind==='table'?openTab(s,link.tableId):null,register=s.registers.find(r=>r.id===(kind==='waiter'?link.registerId:boundTab?.registerId||s.restaurant?.serviceRegisterId)&&!r.closed)||(kind==='table'&&!boundTab?[...s.registers].filter(r=>!r.closed).sort((a,b)=>b.opened.localeCompare(a.opened))[0]:null);
 if(kind==='waiter'&&!register)fail('registerClosed');
 const table=kind==='table'?diningTable(s,link.tableId):null;
 const {name,logo,language,theme,tableCustomerMode}=s.business,c=register?.currency||s.business.currency;
 return {business:{name,logo,language,theme,currency:c,restaurantEnabled:true,commerceType:s.business.commerceType,tableCustomerMode},restaurant:{tables:kind==='waiter'?tableViews(s):[{...table,tab:(()=>{const tab=tabSummary(s,openTab(s,table.id));if(!tab)return null;const {orders,...safe}=tab;return safe;})()}],canOrder:!!register&&(kind==='waiter'||tableCustomerMode==='order'),registerId:register?.id||'',kind},products:s.products.filter(p=>p.active&&(kind==='waiter'||p.published)).map(({id,name,code,category,description,image,prices,stock,trackStock,unit})=>({id,name,code,category,description,image,prices,stock:Math.max(0,stock-reservedQuantity(s,id)),trackStock,unit}))};
}
function addDiningOrder(s,tableId,registerId,b,actor,guest=false){
 diningRequired(s);const table=diningTable(s,tableId),r=openRegister(s,registerId);
 const requestId=text(b.requestId,100);if(requestId.length<12)fail('requestIdRequired');
 const previous=s.orders.find(o=>o.requestId===requestId);
 if(previous){if(previous.tableId!==table.id||previous.registerId!==r.id)fail('concurrentUpdate',409);return {id:previous.id,number:previous.number,tabId:previous.tabId};}
 let tab=openTab(s,table.id);if(tab&&tab.registerId!==r.id)fail('tableOtherRegister',409);
 const items=priceItems(s,{items:b.items,currency:r.currency,wholesale:false},guest),total=items.reduce((n,i)=>n+i.total,0);
 if(!tab){tab={id:id(),tableId:table.id,tableCode:table.code,registerId:r.id,currency:r.currency,revision:0,status:'open',opened:now()};s.restaurant.tabs.push(tab);}
 const keyId=id(),order={id:keyId,number:`M${table.code}-${keyId.slice(0,6).toUpperCase()}`,date:now(),items,total,currency:r.currency,customer:`Mesa ${table.code}`,phone:'',table:table.code,tableId:table.id,tabId:tab.id,registerId:r.id,notes:text(b.notes,1000),waiter:text(actor,100),channel:guest?'table':'waiter',status:'new',requestId};
 s.orders.push(order);tab.revision++;return {id:order.id,number:order.number,tabId:tab.id};
}
export function diningPublicOrder(s,key,kind,b,keyHash){
 const view=diningPublic(s,key,kind,keyHash),link=resolveLink(s,key,kind,keyHash);
 if(!view.restaurant.canOrder)fail('menuOnly',403);
 if(b.currency!==view.business.currency)fail('registerCurrency');
 const tableId=kind==='table'?link.tableId:b.tableId;
 if(kind==='table'&&b.tableId&&b.tableId!==tableId)fail('forbidden',403);
 if(kind==='waiter'&&!text(b.waiter,100))fail('required');
 return addDiningOrder(s,tableId,view.restaurant.registerId,b,kind==='waiter'?b.waiter:'Cliente',kind==='table');
}
export function diningMutation(s,u,path,b,context={}){
 diningRequired(s);
 if(path==='/api/restaurant/orders'){
  const r=openRegister(s,b.registerId,u);if(b.currency!==r.currency)fail('registerCurrency');s.restaurant.serviceRegisterId=r.id;
  return addDiningOrder(s,b.tableId,r.id,b,u.name);
 }
 if(path==='/api/restaurant/links'){
  if(!['table','waiter'].includes(b.kind))fail('invalidLink');
  const r=openRegister(s,b.registerId,u);s.restaurant.serviceRegisterId=r.id;
  if(b.kind==='table')diningTable(s,b.tableId);
  const existing=s.links.find(l=>l.kind===b.kind&&l.active&&l.expires>Date.now()&&(b.kind==='table'?l.tableId===b.tableId:l.registerId===r.id));
  if(existing&&!b.rotate)return {token:existing.raw,kind:existing.kind,tableId:existing.tableId,registerId:existing.registerId};
  if(existing)existing.active=0;
  if(!context.linkHash||!context.linkToken||!context.linkCode)fail('invalidLink');
  const link={token:context.linkHash,raw:context.linkToken,code:context.linkCode,kind:b.kind,active:1,expires:b.kind==='table'?253402300799000:Date.now()+7*86400000,...(b.kind==='table'?{tableId:b.tableId}:{registerId:r.id})};
  s.links.push(link);return {token:link.raw,kind:link.kind,tableId:link.tableId,registerId:link.registerId};
 }
 fail('notFound',404);
}
export function prepareTabSale(s,u,b){
 diningRequired(s);const tab=s.restaurant.tabs.find(t=>t.id===b.tabId&&t.status==='open');
 if(!tab)fail('tabClosed',409);
 const r=openRegister(s,tab.registerId,u);if(b.registerId!==r.id||b.currency!==tab.currency)fail('registerCurrency');
 if(b.tabRevision!==tab.revision)fail('concurrentUpdate',409);
 const summary=tabSummary(s,tab);if(!summary.items.length)fail('emptyCart');
 for(const key of new Set(summary.items.map(i=>i.id))){const p=product(s,key),q=summary.items.filter(i=>i.id===key).reduce((n,i)=>n+i.quantity,0);if(p.trackStock&&q>p.stock-reservedQuantity(s,key,tab.id))fail('insufficientStock');}
 return {tab,items:summary.items.map(({orderId,...item})=>item)};
}
export function finishTabSale(s,tab,sale){tab.status='closed';tab.closed=now();tab.saleId=sale.id;tab.revision++;for(const o of s.orders)if(o.tabId===tab.id&&['new','accepted'].includes(o.status))o.status='completed';sale.tabId=tab.id;sale.table=tab.tableCode;}
export function assertNoOpenTabs(s,registerId){if((s.restaurant?.tabs||[]).some(t=>t.status==='open'&&t.registerId===registerId))fail('openTabs');}
