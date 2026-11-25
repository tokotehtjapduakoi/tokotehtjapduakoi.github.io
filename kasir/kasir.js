/* Kasir Tjap Dua Koi: login staf, persetujuan perangkat, logout otomatis, layar jual. */
(function(){
"use strict";
const CFG=window.KASIR_CONFIG||{};
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(m){const t=$("toast");t.textContent=m;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(()=>t.hidden=true,3200)}
const putus=e=>/Failed to fetch|NetworkError|Load failed|network error/i.test((e&&e.message)||String(e));
const errMsg=e=>putus(e)?"Koneksi internet bermasalah.":((e&&e.message)||String(e));
const DIAM_MAKS=30*60*1000; // logout otomatis setelah 30 menit tanpa sentuhan/ketikan

const S={sb:null,user:null,me:null,catalog:null,device:null,screen:"masuk"};
let galat="",sibuk=false,emailTerakhir="";
async function rpc(fn,a){const {data,error}=await S.sb.rpc(fn,a||{});if(error)throw error;return data}
// Antrean nota offline (Task 10). Selama belum ada, dianggap kosong.
const antrean=()=>window.Antrean&&typeof window.Antrean.jumlah==="function"?window.Antrean.jumlah():0;

/* ---------- Perangkat ---------- */
function deviceId(){let id=localStorage.getItem("kasir.device");
  if(!/^[0-9a-f]{32}$/.test(id||"")){const b=new Uint8Array(16);crypto.getRandomValues(b);
    id=Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");localStorage.setItem("kasir.device",id)}
  return id}
function labelUA(){const u=navigator.userAgent;
  const os=(u.match(/Android [\d.]+|iPhone|iPad|Windows|Mac OS X|CrOS|Linux/)||["Perangkat"])[0];
  const b=u.match(/(Edg|OPR|SamsungBrowser|Firefox|CriOS|Chrome|Version)\/(\d+)/);
  const nama=b&&({Edg:"Edge",OPR:"Opera",CriOS:"Chrome",Version:"Safari"}[b[1]]||b[1]);
  return (nama?nama+" "+b[2]+" · ":"")+os}
const sudahDiminta=()=>localStorage.getItem("kasir.device.diminta")==="1";

/* ---------- Layar ---------- */
function vMasuk(){return `<div class="head"><h1>Kasir</h1><span class="small muted">Tjap Dua Koi</span></div>
  <section class="card"><h2>Masuk</h2>
  <form id="af"><label for="em">Email<input id="em" type="email" autocomplete="username" required value="${esc(emailTerakhir)}"></label>
  <label for="pw">Kata sandi<input id="pw" type="password" autocomplete="current-password" required></label>
  ${sudahDiminta()?"":`<label for="nm">Nama HP ini (opsional)<input id="nm" maxlength="40" autocomplete="off" placeholder="mis. HP kasir depan"></label>`}
  ${galat?`<p class="err" role="alert">${esc(galat)}</p>`:""}
  <button type="submit" class="btn" id="ab">Masuk</button></form></section>`}
function bindMasuk(){$("af").onsubmit=async e=>{e.preventDefault();if(sibuk)return;sibuk=true;$("ab").disabled=true;galat="";
  const nama=$("nm")?$("nm").value.trim():"";emailTerakhir=$("em").value.trim();
  try{const r=await S.sb.auth.signInWithPassword({email:emailTerakhir,password:$("pw").value});
    if(r.error)throw r.error;S.user=r.data.user;await mulai(nama)}
  catch(err){galat=/invalid login|credentials/i.test(err.message)?"Email atau kata sandi salah.":errMsg(err);render()}
  finally{sibuk=false;const b=$("ab");if(b)b.disabled=false}}}

function vTunggu(){const dicabut=S.me.device==="revoked";
  return `<div class="head"><h1>Kasir</h1><button type="button" class="btn sm ghost" id="out">Keluar</button></div>
  <section class="card"><h2>${dicabut?"HP ini diblokir pemilik":"Menunggu persetujuan pemilik"}</h2>
  <p class="muted">${dicabut?"Minta pemilik membuka blokir HP ini di menu Perangkat.":"HP ini belum boleh dipakai berjualan. Minta pemilik menyetujui perangkat ini, lalu tekan Cek lagi."}</p>
  <p class="small muted">Kode HP: <span class="kode">${esc(S.device.slice(0,4).toUpperCase())}-${esc(S.device.slice(4,8).toUpperCase())}</span> · ${esc(S.me.name||S.user.email)}</p>
  <button type="button" class="btn" id="cek">Cek lagi</button></section>`}
function bindTunggu(){$("cek").onclick=async()=>{if(sibuk)return;sibuk=true;$("cek").disabled=true;
  try{await muatMe();if(S.me.device!=="approved")toast("Belum disetujui.")}catch(err){toast(errMsg(err))}finally{sibuk=false;render()}}}

/* ---------- Jual: menu -> keranjang -> bayar -> foto -> lunas -> QR/WA ---------- */
const rp=n=>KasirKode.rp(n);
const J0=()=>({tahap:"menu",cart:[],sheet:null,notaId:null,metode:null,uang:"",disc:"",voucher:"",hp:"",
  foto:null,fotoUrl:null,fotoKunci:false,kode:null,pesan:"",sibuk:false,selesai:null});
let J=J0();
const digit=s=>String(s||"").replace(/\D/g,"");
// 08xx / 8xx / +62xx -> 62xx. Kosong -> "". Tidak sah -> null.
function hp62(s){let d=digit(s);if(!d)return "";
  if(d.startsWith("0"))d="62"+d.slice(1);else if(d.startsWith("8"))d="62"+d;
  return /^62[0-9]{8,13}$/.test(d)?d:null}
const cat=()=>S.catalog||{items:[],methods:[],discounts:[]};
const metodeAktif=()=>cat().methods.find(m=>String(m.id)===String(J.metode));
// Hitungan sama dengan server: voucher menggratiskan satu porsi baris pertama, lalu diskon dari sisanya.
function hitung(){const sub=J.cart.reduce((a,l)=>a+l.qty*l.price,0);
  const vc=J.voucher.trim()&&J.cart.length?Math.min(J.cart[0].price,sub):0;
  const d=cat().discounts.find(x=>String(x.id)===String(J.disc));
  const dasar=sub-vc;
  const pot=!d?0:d.kind==="persen"?Math.floor(dasar*d.value/100):Math.min(d.value,dasar);
  const total=dasar-pot,tunai=!!metodeAktif()&&metodeAktif().kind==="tunai",uang=parseInt(digit(J.uang)||"0",10);
  return {sub,vc,pot,total,tunai,uang,kembali:uang-total,d}}
function bisaLunas(){const h=hitung();
  return !J.sibuk&&J.cart.length>0&&!!metodeAktif()&&!!J.foto&&hp62(J.hp)!==null&&(!h.tunai||h.uang>=h.total)}

function vSheet(){const it=cat().items.find(i=>String(i.id)===String(J.sheet));if(!it)return "";
  return `<div class="tirai"><div class="sheet" role="dialog" aria-label="Pilih ukuran ${esc(it.name)}"><h2>${esc(it.name)}</h2>
  <div class="varian">${(it.variants||[]).map(v=>`<button type="button" data-var="${esc(v.id)}">${esc(v.name)} · ${rp(v.price)}</button>`).join("")||`<p class="muted">Belum ada ukuran.</p>`}</div>
  <button type="button" class="btn ghost" id="sheet-x">Batal</button></div></div>`}
function vKeranjang(){if(!J.cart.length)return `<p class="muted">Keranjang kosong. Pilih menu di atas.</p>`;
  return J.cart.map((l,i)=>`<div class="baris"><div><b>${esc(l.item)}</b> ${esc(l.variant)}<div class="small muted">${rp(l.price)} × ${l.qty} = ${rp(l.price*l.qty)}</div></div>
  <div class="qty"><button type="button" data-min="${i}" aria-label="Kurangi satu"${l.qty<=1?" disabled":""}>−</button><span aria-label="Jumlah">${l.qty}</span><button type="button" data-plus="${i}" aria-label="Tambah satu">+</button><button type="button" data-del="${i}" aria-label="Hapus baris">✕</button></div></div>`).join("")}
function vMenu(){const items=cat().items,kats=[...new Set(items.map(i=>i.category||"Lainnya"))];
  const total=J.cart.reduce((a,l)=>a+l.qty*l.price,0);
  return `<section class="card"><h2>Menu</h2>${items.length?kats.map(k=>`<h3>${esc(k)}</h3><div class="menu">${items.filter(i=>(i.category||"Lainnya")===k)
    .map(i=>`<button type="button" data-item="${esc(i.id)}">${esc(i.name)}</button>`).join("")}</div>`).join(""):`<p class="muted">Belum ada menu. Pemilik menambah menu di halaman pengaturan.</p>`}</section>
  <section class="card"><h2>Keranjang</h2>${vKeranjang()}
  <div class="total"><span>Total</span><b>${rp(total)}</b></div>
  <button type="button" class="btn" id="bayar"${J.cart.length?"":" disabled"}>Bayar</button></section>${vSheet()}`}

function vBayar(){const c=cat(),h=hitung();
  return `<section class="card"><div class="head"><h2>Bayar</h2><button type="button" class="btn sm ghost" id="balik">← Keranjang</button></div>
  <div id="ringkas">${vRingkas(h)}</div>
  <div><div class="small muted">Cara bayar</div><div class="metode">${c.methods.map(m=>`<button type="button" data-metode="${esc(m.id)}" aria-pressed="${String(m.id)===String(J.metode)}">${esc(m.name)}</button>`).join("")}</div></div>
  ${h.tunai?`<div class="tunai"><label for="uang">Uang diterima<input id="uang" inputmode="numeric" autocomplete="off" value="${esc(J.uang)}"></label>
  <div class="cepat"><button type="button" data-cepat="pas">Uang pas</button>${[20000,50000,100000].map(n=>`<button type="button" data-cepat="${n}">${n/1000}rb</button>`).join("")}</div>
  <p id="kembali" class="kembali">${vKembali(h)}</p></div>`:""}
  ${c.discounts.length?`<label for="dk">Diskon (opsional)<select id="dk"><option value="">Tanpa diskon</option>${c.discounts.map(d=>`<option value="${esc(d.id)}"${String(d.id)===String(J.disc)?" selected":""}>${esc(d.name)} (${d.kind==="persen"?esc(d.value)+"%":rp(d.value)})</option>`).join("")}</select></label>`:""}
  <label for="vc">Voucher TK- (opsional)<input id="vc" autocomplete="off" autocapitalize="characters" placeholder="TK-..." value="${esc(J.voucher)}"></label>
  <label for="hp">Nomor HP pelanggan (opsional)<input id="hp" type="tel" inputmode="tel" autocomplete="off" placeholder="0812..." value="${esc(J.hp)}"></label>
  <p class="err" id="hperr" role="alert"></p>
  <div class="fotobox"><button type="button" class="btn ghost" id="foto"${J.fotoKunci?" disabled":""}>${J.fotoKunci?"Foto terkunci":J.foto?"Ganti foto bukti":"Ambil foto bukti"}</button>
  ${J.fotoKunci?`<span class="small muted">Foto sudah terunggah sebagai bukti nota ini, tidak bisa diganti.</span>`:""}
  ${J.fotoUrl?`<img class="prat" src="${esc(J.fotoUrl)}" alt="Pratinjau foto bukti">`:`<span class="small muted">Foto bukti wajib sebelum Lunas.</span>`}</div>
  <p class="err" id="pesan" role="alert">${esc(J.pesan)}</p>
  <button type="button" class="btn lunas" id="lunas">Lunas</button></section>`}
function vRingkas(h){return `${h.vc?`<div class="rg"><span>Voucher (1 porsi gratis)</span><span>−${rp(h.vc)}</span></div>`:""}
  ${h.pot?`<div class="rg"><span>Diskon ${esc(h.d.name)}</span><span>−${rp(h.pot)}</span></div>`:""}
  <div class="total"><span>Total</span><b>${rp(h.total)}</b></div>`}
function vKembali(h){if(!h.uang)return "";return h.kembali>=0?`Kembalian ${rp(h.kembali)}`:`Kurang ${rp(-h.kembali)}`}
function segarBayar(){const h=hitung();
  $("ringkas").innerHTML=vRingkas(h);const k=$("kembali");if(k)k.textContent=vKembali(h);
  const ok=hp62(J.hp)!==null;$("hperr").textContent=ok?"":"Nomor HP belum benar. Contoh: 0812 3456 7890.";
  $("lunas").disabled=!bisaLunas()}

function vSelesai(){const s=J.selesai,r=s.hasil;
  const aktif=r.code_status==="aktif";
  return `<section class="card selesai"><h2>Lunas</h2><p class="small muted">Nota <b class="kode">${esc(r.no)}</b></p>
  <div class="total"><span>Total</span><b>${rp(r.total)}</b></div>
  ${s.tunai&&r.change!=null?`<p class="kembali besar">Kembalian ${rp(r.change)}</p>`:""}
  ${aktif?`<div class="qr" aria-label="QR kode klaim">${KasirKode.qrSvg(KasirKode.urlKlaim(s.kode))}</div>
  <p class="tengah-teks">Kode: <span class="kode" id="kode-klaim">${esc(KasirKode.tampil(s.kode))}</span></p>
  <p class="small muted tengah-teks">Pelanggan scan QR ini untuk menarik kartu koi di Kolam Koi.</p>`
  :r.code_status==="ditahan"?`<p class="muted">Kode klaim ditahan. Hubungi pemilik.</p>`
  :`<p class="muted">Total Rp0: tidak ada kartu koi untuk nota ini.</p>`}
  <div class="aksi">${aktif&&s.hp?`<a class="btn" id="wa" target="_blank" rel="noopener" href="${esc(KasirKode.linkWa(s.hp,s.teks))}">Kirim WA</a>`:""}
  <button type="button" class="btn ${aktif&&s.hp?"ghost":""}" id="baru">Nota baru</button></div></section>`}

function vJual(){
  const kepala=`<div class="head"><h1>Kasir</h1><button type="button" class="btn sm ghost" id="out">Keluar</button></div><p class="small muted">${esc(S.me.name||S.user.email)}</p>`;
  if(!S.me.shift)return kepala+`<section class="card"><h2>Buka shift dulu</h2><p class="muted">Shift belum dibuka, jadi belum bisa berjualan.</p><button type="button" class="btn" id="cek-shift">Cek lagi</button></section>`;
  return kepala+(J.tahap==="bayar"?vBayar():J.tahap==="selesai"?vSelesai():vMenu())}

function tambah(v,it){const l=J.cart.find(x=>String(x.vid)===String(v.id));
  if(l)l.qty=Math.min(l.qty+1,999);else J.cart.push({vid:v.id,item:it.name,variant:v.name,price:v.price,qty:1})}
// Harga/menu berubah di server: muat ulang katalog, hitung ulang harga keranjang, buang baris yang sudah tidak ada.
async function muatUlangMenu(){S.catalog=await rpc("pos_catalog");
  const peta={};for(const i of S.catalog.items)for(const v of i.variants||[])peta[v.id]={i,v};
  if(J.disc&&!S.catalog.discounts.some(d=>String(d.id)===String(J.disc)))J.disc="";
  if(J.metode&&!S.catalog.methods.some(m=>String(m.id)===String(J.metode)))J.metode=S.catalog.methods.length?S.catalog.methods[0].id:null;
  J.cart=J.cart.filter(l=>peta[l.vid]).map(l=>{const {i,v}=peta[l.vid];return {...l,item:i.name,variant:v.name,price:v.price}})}

// Langkah kirim nota: unggah foto, lalu pos_checkout. Satu fungsi supaya antrean offline (Task 10) bisa membungkusnya.
// saatUnggah dipanggil begitu foto tersimpan di server (sejak itu foto jadi bukti dan tidak boleh diganti).
async function kirimNota(p,foto,saatUnggah){
  const {error}=await S.sb.storage.from("bukti").upload(p.photo_path,foto,{contentType:"image/jpeg",upsert:false});
  if(error&&String(error.statusCode||error.status)!=="409"&&!/already exists|duplicate/i.test(error.message||""))throw error;
  if(saatUnggah)saatUnggah();
  try{return {hasil:await rpc("pos_checkout",{p}),kode:p.code}}
  catch(e){if(!/Kode bentrok/i.test((e&&e.message)||""))throw e;
    p.code=KasirKode.buat();return {hasil:await rpc("pos_checkout",{p}),kode:p.code}}}

function bangunPayload(){const h=hitung(),m=metodeAktif();
  return {id:J.notaId,device:S.device,client_at:new Date().toISOString(),offline:false,
    lines:J.cart.map(l=>({variant_id:l.vid,qty:l.qty})),discount_id:J.disc?Number(J.disc):null,
    voucher_code:J.voucher.trim()||null,method_id:m.id,total:h.total,cash_received:h.tunai?h.uang:null,
    photo_path:`${S.user.id}/${J.notaId}.jpg`,customer_phone:hp62(J.hp)||null,code:J.kode}}
// Baris untuk teks WA: seperti nota di server (voucher = 1 porsi baris pertama gratis).
function barisWa(){const l=J.cart.map(x=>({qty:x.qty,item:x.item,variant:x.variant,price:x.price}));
  if(J.voucher.trim()&&l.length){const f=l[0];if(f.qty>1){l[0]={...f,qty:f.qty-1};l.push({...f,qty:1,variant:f.variant+" (voucher)",price:0})}else l[0]={...f,variant:f.variant+" (voucher)",price:0}}
  return l}
async function lunas(){if(!bisaLunas())return;J.sibuk=true;J.pesan="";segarBayar();$("lunas").textContent="Menyimpan...";
  let p=null;
  try{p=bangunPayload();const h=hitung(),m=metodeAktif(),baris=barisWa(),hp=hp62(J.hp)||"";
    const {hasil,kode}=await kirimNota(p,J.foto,()=>{J.fotoKunci=true});
    const teks=KasirKode.teksWa({no:hasil.no,lines:baris,total:hasil.total,method:m.name,kode});
    J.selesai={hasil,kode,tunai:h.tunai,hp,teks};J.tahap="selesai";
    if(J.fotoUrl)URL.revokeObjectURL(J.fotoUrl);J.fotoUrl=null;J.foto=null}
  catch(err){const msg=errMsg(err);
    if(/Harga berubah|muat ulang menu/i.test(msg)){try{await muatUlangMenu();J.pesan="Harga menu berubah. Menu sudah dimuat ulang dan total dihitung ulang. Periksa lagi, lalu tekan Lunas.";
      if(!J.cart.length)J.tahap="menu"}catch(e2){J.pesan=errMsg(e2)}}
    else J.pesan=msg}
  finally{J.sibuk=false;if(p)J.kode=p.code}render()}

function bindJual(){
  const cs=$("cek-shift");if(cs)cs.onclick=async()=>{cs.disabled=true;try{await muatMe()}catch(e){toast(errMsg(e))}render()};
  if(!S.me.shift)return;
  if(J.tahap==="selesai"){$("baru").onclick=()=>{J=J0();render()};return}
  if(J.tahap==="bayar"){bindBayar();return}
  document.querySelectorAll("[data-item]").forEach(b=>b.onclick=()=>{J.sheet=b.dataset.item;render()});
  document.querySelectorAll("[data-var]").forEach(b=>b.onclick=()=>{const it=cat().items.find(i=>String(i.id)===String(J.sheet));
    const v=it&&(it.variants||[]).find(x=>String(x.id)===b.dataset.var);if(v)tambah(v,it);J.sheet=null;render()});
  const sx=$("sheet-x");if(sx)sx.onclick=()=>{J.sheet=null;render()};
  document.querySelectorAll("[data-min]").forEach(b=>b.onclick=()=>{const l=J.cart[b.dataset.min];if(l&&l.qty>1)l.qty--;render()});
  document.querySelectorAll("[data-plus]").forEach(b=>b.onclick=()=>{const l=J.cart[b.dataset.plus];if(l)l.qty=Math.min(l.qty+1,999);render()});
  document.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{J.cart.splice(Number(b.dataset.del),1);render()});
  $("bayar").onclick=()=>{if(!J.cart.length)return;if(!J.notaId){J.notaId=crypto.randomUUID();J.kode=KasirKode.buat()}
    if(!J.metode&&cat().methods.length)J.metode=cat().methods[0].id;J.pesan="";J.tahap="bayar";render()}}
function bindBayar(){
  $("balik").onclick=()=>{J.tahap="menu";render()};
  document.querySelectorAll("[data-metode]").forEach(b=>b.onclick=()=>{J.metode=b.dataset.metode;render()});
  const u=$("uang");if(u)u.oninput=()=>{J.uang=u.value;segarBayar()};
  document.querySelectorAll("[data-cepat]").forEach(b=>b.onclick=()=>{
    J.uang=String(b.dataset.cepat==="pas"?hitung().total:b.dataset.cepat);$("uang").value=J.uang;segarBayar()});
  const dk=$("dk");if(dk)dk.onchange=()=>{J.disc=dk.value;segarBayar()};
  $("vc").oninput=e=>{J.voucher=e.target.value;segarBayar()};
  $("hp").oninput=e=>{J.hp=e.target.value;segarBayar()};
  $("foto").onclick=async()=>{try{const f=await KasirFoto.ambil();const k=await KasirFoto.kecilkan(f);
      if(J.fotoUrl)URL.revokeObjectURL(J.fotoUrl);J.foto=k;J.fotoUrl=URL.createObjectURL(k);J.pesan="";render()}
    catch(e){if(!/dibatalkan|Tidak ada foto/.test(e.message))toast(errMsg(e))}};
  $("lunas").onclick=lunas;segarBayar()}

function vPutus(){return `<div class="head"><h1>Kasir</h1></div><section class="card"><h2>Koneksi internet bermasalah</h2>
  <p class="muted">Belum bisa memeriksa akun dan HP ini. Periksa sinyal, lalu coba lagi.</p><button type="button" class="btn" id="ulang">Coba lagi</button></section>`}
function bindPutus(){$("ulang").onclick=()=>mulai("")}

function render(){const app=$("app");
  if(!S.sb){app.innerHTML=`<section class="card"><h2>Belum disambungkan</h2><p class="muted">Isi <code>kasir/config.js</code> dengan Project URL dan kunci publishable Supabase.</p></section>`;return}
  const V={masuk:[vMasuk,bindMasuk],tunggu:[vTunggu,bindTunggu],jual:[vJual,bindJual],putus:[vPutus,bindPutus]}[S.screen];
  app.innerHTML=V[0]();V[1]();const o=$("out");if(o)o.onclick=()=>keluar(false)}

/* ---------- Alur ---------- */
async function muatMe(){S.me=await rpc("pos_me",{p_device:S.device});
  if(S.me.device==="approved"){S.catalog=await rpc("pos_catalog");S.screen="jual"}else S.screen="tunggu"}
async function mulai(nama){S.device=deviceId();
  try{await rpc("pos_device_request",{p_device:S.device,p_label:((nama?nama+" · ":"")+labelUA()).slice(0,80)});
    localStorage.setItem("kasir.device.diminta","1");await muatMe()}
  catch(err){if(putus(err)){S.screen="putus";render();return}  // jangan keluarkan kasir hanya karena sinyal
    const m=errMsg(err);await keluar(true);galat=m==="Khusus kasir"?"Akun ini bukan staf toko. Minta pemilik menambahkan emailmu.":m;render();return}
  aktif=Date.now();render()}
// otomatis=true: dipanggil sistem (diam/gagal masuk). Keluar manual ditolak selama antrean belum kosong.
async function keluar(otomatis){const n=antrean();
  if(n>0){if(!otomatis)toast(`Masih ada ${n} nota belum terkirim. Sambungkan internet dulu.`);return}
  const r=await S.sb.auth.signOut().catch(e=>({error:e}));
  if(r&&r.error)await S.sb.auth.signOut({scope:"local"}).catch(()=>{});
  Object.assign(S,{user:null,me:null,catalog:null,screen:"masuk"});J=J0();galat="";render()}

/* ---------- Logout otomatis ---------- */
let aktif=Date.now();
["pointerdown","keydown"].forEach(ev=>addEventListener(ev,()=>{aktif=Date.now()},{capture:true,passive:true}));
function cekDiam(){if(!S.user||Date.now()-aktif<DIAM_MAKS||antrean()>0)return;
  keluar(true).then(()=>toast("Keluar otomatis: 30 menit tidak dipakai."))}
setInterval(cekDiam,30*1000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)cekDiam()});

async function boot(){if(!CFG.supabaseUrl||!CFG.supabaseKey||!window.supabase){render();return}
  S.sb=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true,storageKey:"kasir-auth"}});
  const {data}=await S.sb.auth.getSession();S.user=data.session&&data.session.user;
  if(S.user)await mulai("");else render()}
boot();
})();
