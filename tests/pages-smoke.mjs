import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

let redirectMode=false;
const root=resolve('.');
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/ONLY/public/site-config.json'&&redirectMode){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({systemUrl:'https://only-system.example/'}));}
  if(!path.startsWith('/ONLY/')){res.writeHead(404);return res.end();}
  const local=path.slice('/ONLY/'.length)||'index.html';
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
  try{const body=await readFile(resolve(root,local));res.setHeader('Content-Type',mime[extname(local)]||'text/plain');res.end(body);}catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}/ONLY/`;
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--no-zygote','--disable-dev-shm-usage','--disable-gpu','--single-process'],headless:true});
try{
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[],failed=[],apiCalls=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failed.push(r.url());});page.on('request',r=>{if(r.url().includes('/api/'))apiCalls.push(r.url());});
  await page.goto(base);await page.getByRole('heading',{name:'Seu negócio. Seu ritmo.',exact:true}).waitFor();
  assert.ok(await page.locator('[data-form=login] [type=submit]').isDisabled());
  assert.match(await page.locator('.notice').innerText(),/Falta conectar/);
  assert.equal(await page.locator('h1').innerText(),'Venda com leveza.\nGerencie com clareza.');
  assert.deepEqual(apiCalls,[]);assert.deepEqual(failed,[]);assert.deepEqual(errors,[]);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/pages-entry.png',fullPage:true,animations:'disabled'});
  redirectMode=true;
  await context.route('https://only-system.example/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Servidor ONLY</h1>'}));
  await page.goto(base);await page.waitForURL('https://only-system.example/');await page.getByRole('heading',{name:'Servidor ONLY'}).waitFor();
  console.log('Pages entry passed: application at /ONLY/, local assets, truthful connection state, mobile layout, configured server redirect.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
