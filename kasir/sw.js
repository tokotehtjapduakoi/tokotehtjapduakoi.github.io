/* Service worker Kasir: halaman, skrip, dan font disimpan di HP supaya kasir tetap terbuka tanpa internet.
   - Berkas kasir/* : diambil dari cache dulu, lalu diperbarui diam-diam dari jaringan (versi baru tampil pada pembukaan berikutnya).
   - kolam/vendor/* dan font: dari cache dulu (nama berkas sudah berversi), jaringan hanya bila belum ada.
   - Lainnya (Supabase *.supabase.co, API di luar folder kasir/): tidak disentuh, selalu lewat jaringan.
   Ganti CACHE (kasir-v2, ...) bila daftar INTI berubah atau cache lama perlu dibuang. */
const CACHE="kasir-v1";
const INTI=["./","kasir.css","config.js","kode.js","foto.js","antrean.js","kasir.js","manifest.webmanifest","ikon.svg",
  "../kolam/vendor/supabase-2.45.4.js","../kolam/vendor/qrcode-generator-1.4.4.js","../favicon.ico"];
const LINGKUP=new URL("./",self.registration.scope);
const VENDOR=new URL("../kolam/vendor/",LINGKUP).pathname;
const FAVICON=new URL("../favicon.ico",LINGKUP).pathname;
const FONT=/^https:\/\/fonts\.(googleapis|gstatic)\.com$/;

self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(INTI)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys()
  .then(k=>Promise.all(k.filter(n=>n.startsWith("kasir-")&&n!==CACHE).map(n=>caches.delete(n))))
  .then(()=>self.clients.claim()))});

// "segar" = cache dulu + perbarui di belakang; "tetap" = cache dulu; null = tidak ditangani (jaringan biasa).
function jenis(url){
  if(url.origin===self.location.origin){
    if(url.pathname.startsWith(VENDOR)||url.pathname===FAVICON)return "tetap";
    if(url.pathname.startsWith(LINGKUP.pathname)&&!url.pathname.endsWith("/sw.js"))return "segar";
    return null}
  return FONT.test(url.origin)?"tetap":null}

self.addEventListener("fetch",e=>{const q=e.request;if(q.method!=="GET")return;
  const url=new URL(q.url),j=jenis(url);if(!j)return;
  // Halaman kasir (/kasir/, /kasir/index.html, dengan atau tanpa ?query) disimpan dengan satu kunci.
  const halaman=q.mode==="navigate"&&(url.pathname===LINGKUP.pathname||url.pathname===LINGKUP.pathname+"index.html");
  e.respondWith(dariCache(e,halaman?LINGKUP.href:q,j))});

async function dariCache(e,kunci,j){const c=await caches.open(CACHE);
  const lama=await c.match(kunci,{ignoreSearch:true});
  if(lama&&j==="tetap")return lama;
  const baru=fetch(e.request).then(r=>{if(r.ok||r.type==="opaque")return c.put(kunci,r.clone()).then(()=>r);return r});
  if(lama){e.waitUntil(baru.catch(()=>{}));return lama}
  return baru}
