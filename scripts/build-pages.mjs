import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const html = (await readFile(new URL('public/index.html', root), 'utf8'))
  .replace('href="/manifest.webmanifest"', 'href="./site.webmanifest"')
  .replace('href="/icon.svg"', 'href="./public/icon.svg"')
  .replace('href="/styles.css"', 'href="./public/styles.css"')
  .replace('src="/app.js"', 'src="./public/pages-entry.js"');
await writeFile(new URL('index.html', root), html);
await writeFile(new URL('.nojekyll', root), '');
await writeFile(new URL('site.webmanifest', root), JSON.stringify({
  id:'./', name:'ONLY — PDV & ERP', short_name:'ONLY', start_url:'./', scope:'./',
  display:'standalone', background_color:'#111015', theme_color:'#111015',
  icons:[{src:'./public/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any maskable'}]
},null,2)+'\n');
console.log('GitHub Pages entry generated.');
