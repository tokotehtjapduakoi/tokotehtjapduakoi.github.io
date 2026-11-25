/* Kasir Tjap Dua Koi: login staf, persetujuan perangkat, logout otomatis, layar jual, mode offline. */
(function(){
"use strict";
const CFG=window.KASIR_CONFIG||{};
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(m){const t=$("toast");t.textContent=m;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(()=>t.hidden=true,3200)}
const putus=e=>/Failed to fetch|NetworkError|Load failed|network error/i.test((e&&e.message)||String(e));
const errMsg=e=>putus(e)?"Koneksi internet bermasalah.":((e&&e.message)||String(e));
const DIAM_MAKS=30*60*1000; // logout otomatis setelah 30 menit tanpa sentuhan/ketikan

const S={sb:null,user:null,me:null,catalog:null,device:null,screen:"masuk",antre:[],tab:"jual",tutup:null};
let galat="",sibuk=false,emailTerakhir="";
async function rpc(fn,a){const {data,error}=await S.sb.rpc(fn,a||{});if(error)throw error;return data}
// Nota kasir ini yang masih menunggu dikirim (yang ditolak server tidak dihitung: tetap tersimpan untuk pemilik).
const antrean=async()=>{try{return await window.Antrean.jumlah(S.user&&S.user.id)}catch(e){return 0}};
const BATAS_LUNAS=8000; // Lunas menunggu kiriman paling lama ini, lalu layar Selesai tampil dari data HP
const daring=()=>navigator.onLine!==false;

/* ---------- Simpanan untuk buka tanpa internet ---------- */
const bacaJson=k=>{try{return JSON.parse(localStorage.getItem(k)||"null")}catch(e){return null}};
const tulisJson=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};
function simpanSiap(){tulisJson("kasir.me",{uid:S.user.id,me:S.me});if(S.catalog)tulisJson("kasir.catalog",S.catalog)}
// Kasir yang sama, HP sudah disetujui, katalog ada: boleh berjualan offline dengan data terakhir.
function siapOffline(){const m=bacaJson("kasir.me"),c=bacaJson("kasir.catalog");
  return m&&S.user&&m.uid===S.user.id&&m.me&&m.me.device==="approved"&&c?{me:m.me,catalog:c}:null}

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
// Voucher TK- hanya bisa dicek server: saat offline tidak dipakai.
const voucherDipakai=()=>daring()?J.voucher.trim():"";
// Hitungan sama dengan server: voucher menggratiskan satu porsi baris pertama, lalu diskon dari sisanya.
function hitung(){const sub=J.cart.reduce((a,l)=>a+l.qty*l.price,0);
  const vc=voucherDipakai()&&J.cart.length?Math.min(J.cart[0].price,sub):0;
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
  <label for="vc">Voucher TK- (opsional)<input id="vc" autocomplete="off" autocapitalize="characters" placeholder="TK-..." value="${esc(J.voucher)}"${daring()?"":" disabled"}></label>
  ${daring()?"":`<span class="small muted">Voucher TK- tidak bisa dipakai saat offline.</span>`}
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
  return `<section class="card selesai"><h2>Lunas</h2>${s.antre?`<p class="antre">Tersimpan di HP, akan terkirim otomatis</p>`:`<p class="small muted">Nota <b class="kode">${esc(r.no)}</b></p>`}
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
  if(!S.me.shift)return kepala+vTanpaShift();
  if(S.tab==="nota")return kepala+vNota();
  if(S.tab==="kas")return kepala+vKas();
  return kepala+(J.tahap==="bayar"?vBayar():J.tahap==="selesai"?vSelesai():vMenu())}

function tambah(v,it){const l=J.cart.find(x=>String(x.vid)===String(v.id));
  if(l)l.qty=Math.min(l.qty+1,999);else J.cart.push({vid:v.id,item:it.name,variant:v.name,price:v.price,qty:1})}
// Harga/menu berubah di server: muat ulang katalog, hitung ulang harga keranjang, buang baris yang sudah tidak ada.
async function muatUlangMenu(){S.catalog=await rpc("pos_catalog");tulisJson("kasir.catalog",S.catalog);
  const peta={};for(const i of S.catalog.items)for(const v of i.variants||[])peta[v.id]={i,v};
  if(J.disc&&!S.catalog.discounts.some(d=>String(d.id)===String(J.disc)))J.disc="";
  if(J.metode&&!S.catalog.methods.some(m=>String(m.id)===String(J.metode)))J.metode=S.catalog.methods.length?S.catalog.methods[0].id:null;
  J.cart=J.cart.filter(l=>peta[l.vid]).map(l=>{const {i,v}=peta[l.vid];return {...l,item:i.name,variant:v.name,price:v.price}})}

function bangunPayload(){const h=hitung(),m=metodeAktif();
  return {id:J.notaId,device:S.device,client_at:new Date().toISOString(),offline:false,
    lines:J.cart.map(l=>({variant_id:l.vid,qty:l.qty})),discount_id:J.disc?Number(J.disc):null,
    voucher_code:voucherDipakai()||null,method_id:m.id,total:h.total,cash_received:h.tunai?h.uang:null,
    photo_path:`${S.user.id}/${J.notaId}.jpg`,customer_phone:hp62(J.hp)||null,code:J.kode}}
// Baris untuk teks WA: seperti nota di server (voucher = 1 porsi baris pertama gratis).
function barisWa(){const l=J.cart.map(x=>({qty:x.qty,item:x.item,variant:x.variant,price:x.price}));
  if(voucherDipakai()&&l.length){const f=l[0];if(f.qty>1){l[0]={...f,qty:f.qty-1};l.push({...f,qty:1,variant:f.variant+" (voucher)",price:0})}else l[0]={...f,variant:f.variant+" (voucher)",price:0}}
  return l}
const teksSelesai=s=>KasirKode.teksWa({no:s.hasil.no||"(dikirim nanti)",lines:s.baris,total:s.hasil.total,method:s.metode,kode:s.kode});
// Lunas: nota (dengan kode klaim dan foto) selalu masuk antrean dulu, lalu dicoba dikirim.
// Gagal jaringan: layar Selesai tetap tampil dari data HP. Ditolak server: nota dibuang dari antrean, kasir memperbaiki.
async function lunas(){if(!bisaLunas())return;J.sibuk=true;J.pesan="";segarBayar();$("lunas").textContent="Menyimpan...";
  const p=bangunPayload(),h=hitung(),m=metodeAktif();
  const s={id:p.id,tunai:h.tunai,hp:hp62(J.hp)||"",baris:barisWa(),metode:m.name,kode:p.code,antre:true,
    hasil:{no:null,total:h.total,change:h.tunai?h.uang-h.total:null,code_status:h.total>0?"aktif":"tidak_ada"}};
  try{await Antrean.simpan({id:p.id,uid:S.user.id,payload:p,foto:J.foto,fotoPath:p.photo_path,dibuat:Date.now()})}
  catch(err){J.sibuk=false;J.pesan="Nota gagal disimpan di HP: "+errMsg(err);render();return}
  J.fotoKunci=true; // sejak masuk antrean, foto ini bukti nota ini
  // Nota baru dikirim lebih dulu dari sisa antrean. Bila lama (sinyal lemah), jangan tahan kasir:
  // layar Selesai tampil dari data HP, kiriman tetap jalan dan memperbarui layar setelah selesai.
  let setelahDulu;const dulu=new Promise(ok=>{setelahDulu=ok});
  const jalan=Antrean.kirimSemua(S.sb,{uid:S.user.id,dulu:p.id,setelahDulu});
  jalan.then(terapkanHasil,()=>{}).then(segarBilah);
  const r=await Promise.race([dulu,jalan,new Promise(ok=>setTimeout(()=>ok(null),BATAS_LUNAS))]).catch(()=>null)||{hasil:{},ditolak:{}};
  const tolak=r.ditolak[p.id];
  if(tolak){await Antrean.hapus(p.id).catch(()=>{});
    if(/Harga berubah|muat ulang menu/i.test(tolak)){try{await muatUlangMenu();J.pesan="Harga menu berubah. Menu sudah dimuat ulang dan total dihitung ulang. Periksa lagi, lalu tekan Lunas.";
      if(!J.cart.length)J.tahap="menu"}catch(e2){J.pesan=errMsg(e2)}}
    else J.pesan=tolak}
  else{const ok=r.hasil[p.id];
    if(ok)Object.assign(s,{hasil:ok.hasil,kode:ok.kode,antre:false});
    else{const it=await Antrean.ambil(p.id).catch(()=>null);if(it)s.kode=it.payload.code}
    s.teks=teksSelesai(s);J.selesai=s;J.tahap="selesai";
    if(J.fotoUrl)URL.revokeObjectURL(J.fotoUrl);J.fotoUrl=null;J.foto=null}
  J.sibuk=false;await segarBilah();render()}

function bindJual(){
  if(!S.me.shift){bindTanpaShift();return}
  if(S.tab==="nota"){bindNota();return}
  if(S.tab==="kas"){bindKas();return}
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

/* ---------- Shift: buka toko, terima laci ---------- */
const B0=()=>({modal:"",hitung:"",sibuk:false,pesan:"",hasil:null});
let B=B0();
const angka=s=>parseInt(digit(s)||"0",10);
const selisihTeks=n=>(n<0?"−":"+")+rp(Math.abs(n));
function vTanpaShift(){const w=S.me.handover_waiting;
  if(B.hasil){const x=B.hasil.selisih;
    return `<section class="card"><h2>Laci diterima</h2>
    ${x===0?`<p>Hitunganmu cocok dengan kasir sebelumnya. Tidak ada selisih.</p>`:`<p class="selisih" role="status">Selisih ${esc(selisihTeks(x))}</p><p class="muted small">Hitunganmu ${x<0?"kurang":"lebih"} ${rp(Math.abs(x))} dari hitungan kasir sebelumnya. Pemilik akan melihat selisih ini.</p>`}
    <button type="button" class="btn" id="mulai-jual">Mulai jual</button></section>`}
  if(S.tutup)return `<section class="card"><h2>${S.tutup.handover?"Laci diserahkan":"Toko ditutup"}</h2>
    <p class="muted">${S.tutup.handover?"Menunggu kasir berikutnya menerima laci. Kamu bisa keluar.":"Shift sudah ditutup. Terima kasih!"}</p>
    ${S.tutup.handover?"":`<button type="button" class="btn" id="buka-lagi">Buka toko lagi</button>`}</section>`;
  const pesan=`<p class="err" id="pesan" role="alert">${esc(B.pesan)}</p>`;
  if(w&&w.is_mine)return `<section class="card"><h2>Laci sudah diserahkan</h2><p class="muted">Menunggu kasir berikutnya menerima laci. Kamu bisa keluar.</p></section>`;
  if(w)return `<section class="card"><h2>Terima laci dari ${esc(w.cashier_name||"kasir sebelumnya")}</h2>
    <p class="muted">Hitung uang di laci sekarang, lalu ketik jumlahnya.</p>
    <label for="hitung">Uang di laci (Rp)<input id="hitung" inputmode="numeric" autocomplete="off" value="${esc(B.hitung)}"></label>${pesan}
    <button type="button" class="btn" id="terima"${B.sibuk||B.hitung===""?" disabled":""}>Terima laci</button>
    <button type="button" class="btn ghost" id="cek-shift">Cek lagi</button></section>`;
  return `<section class="card"><h2>Buka toko</h2><p class="muted">Ketik modal awal: uang yang ada di laci sekarang.</p>
    <label for="modal">Modal awal di laci (Rp)<input id="modal" inputmode="numeric" autocomplete="off" value="${esc(B.modal)}"></label>${pesan}
    <button type="button" class="btn" id="buka"${B.sibuk||B.modal===""?" disabled":""}>Buka toko</button>
    <button type="button" class="btn ghost" id="cek-shift">Cek lagi</button></section>`}
function bindTanpaShift(){
  const cs=$("cek-shift");if(cs)cs.onclick=async()=>{cs.disabled=true;try{await muatMe()}catch(e){toast(errMsg(e))}render()};
  const ml=$("mulai-jual");if(ml)ml.onclick=async()=>{B=B0();try{await muatMe()}catch(e){toast(errMsg(e))}render()};
  const bl=$("buka-lagi");if(bl)bl.onclick=()=>{S.tutup=null;render()};
  const isi=(id,kunci,tombol)=>{const e=$(id);if(e)e.oninput=()=>{B[kunci]=digit(e.value);e.value=B[kunci];$(tombol).disabled=B.sibuk||B[kunci]===""}};
  isi("modal","modal","buka");isi("hitung","hitung","terima");
  const kerja=(id,fn)=>{const b=$(id);if(b)b.onclick=async()=>{if(B.sibuk)return;B.sibuk=true;B.pesan="";b.disabled=true;
    try{await fn()}catch(e){B.pesan=errMsg(e)}B.sibuk=false;render()}};
  kerja("buka",async()=>{await rpc("pos_shift_open",{p_device:S.device,p_cash_start:angka(B.modal)});S.tutup=null;B=B0();await muatMe()});
  kerja("terima",async()=>{const r=await rpc("pos_shift_receive",{p_device:S.device,p_count:angka(B.hitung)});
    S.tutup=null;B={...B0(),hasil:{selisih:r.selisih}}})}

/* ---------- Kas: serah terima / tutup toko ---------- */
const K0=()=>({mode:null,hitung:"",foto:null,fotoUrl:null,fotoPath:null,sibuk:false,pesan:""});
let K=K0();
const acak=()=>{const b=new Uint8Array(4);crypto.getRandomValues(b);return Array.from(b,x=>x.toString(16).padStart(2,"0")).join("")};
const nPending=()=>S.antre.filter(it=>!it.error&&Antrean.milik(it)===S.user.id).length;
const pesanAntre=n=>`Masih ada ${n} nota belum terkirim. Sambungkan internet dulu.`;
function bisaTutup(){return !K.sibuk&&K.hitung!==""&&!!K.foto}
function vKas(){const sh=S.me.shift,n=nPending(),kunci=n>0;
  const mulaiDari=sh.opened_at?waktuHP(sh.opened_at):"";
  const kepala=`<section class="card"><h2>Kas</h2><p class="small muted">Shift dibuka ${esc(mulaiDari)} · modal awal ${rp(sh.cash_start)}</p>
    ${kunci?`<p class="err" role="alert">${esc(pesanAntre(n))}</p>`:""}
    <div class="aksi"><button type="button" class="btn${K.mode==="serah"?"":" ghost"}" id="m-serah"${kunci?" disabled":""}>Serah terima ke kasir berikutnya</button>
    <button type="button" class="btn${K.mode==="tutup"?"":" ghost"}" id="m-tutup"${kunci?" disabled":""}>Tutup toko</button></div></section>`;
  if(!K.mode||kunci)return kepala;
  return kepala+`<section class="card"><h2>${K.mode==="serah"?"Serah terima laci":"Tutup toko"}</h2>
    <p class="muted">Hitung semua uang di laci, ketik jumlahnya, lalu foto laci.</p>
    <label for="hitung">Uang di laci (Rp)<input id="hitung" inputmode="numeric" autocomplete="off" value="${esc(K.hitung)}"></label>
    <div class="fotobox"><button type="button" class="btn ghost" id="foto-laci"${K.sibuk?" disabled":""}>${K.foto?"Ganti foto laci":"Ambil foto laci"}</button>
    ${K.fotoUrl?`<img class="prat" src="${esc(K.fotoUrl)}" alt="Pratinjau foto laci">`:`<span class="small muted">Foto laci wajib.</span>`}</div>
    <p class="err" id="pesan" role="alert">${esc(K.pesan)}</p>
    <button type="button" class="btn lunas" id="kirim-tutup"${bisaTutup()?"":" disabled"}>${K.mode==="serah"?"Serahkan laci":"Tutup toko sekarang"}</button></section>`}
function bindKas(){
  const m=(id,mode)=>{const b=$(id);if(b)b.onclick=()=>{K.mode=mode;K.pesan="";render()}};m("m-serah","serah");m("m-tutup","tutup");
  const h=$("hitung");if(h)h.oninput=()=>{K.hitung=digit(h.value);h.value=K.hitung;$("kirim-tutup").disabled=!bisaTutup()};
  const f=$("foto-laci");if(f)f.onclick=async()=>{try{const x=await KasirFoto.ambil();const k=await KasirFoto.kecilkan(x);
      if(K.fotoUrl)URL.revokeObjectURL(K.fotoUrl);K.foto=k;K.fotoUrl=URL.createObjectURL(k);K.fotoPath=null;K.pesan="";render()}
    catch(e){if(!/dibatalkan|Tidak ada foto/.test(e.message))toast(errMsg(e))}};
  const t=$("kirim-tutup");if(t)t.onclick=tutupShift}
async function tutupShift(){if(!bisaTutup())return;
  const n=await antrean();if(n>0){K.pesan=pesanAntre(n);render();return}
  K.sibuk=true;K.pesan="";$("kirim-tutup").disabled=true;$("foto-laci").disabled=true;
  const serah=K.mode==="serah",sid=S.me.shift.id;
  try{// Foto laci terunggah sekali; kalau tutup shift gagal lalu diulang, foto yang sama dipakai lagi.
    if(!K.fotoPath){const path=`${S.user.id}/laci-${sid}-${acak()}.jpg`;
      const {error}=await S.sb.storage.from("bukti").upload(path,K.foto,{contentType:"image/jpeg",upsert:false});
      if(error)throw error;K.fotoPath=path}
    await rpc("pos_shift_close",{p_cash_counted:angka(K.hitung),p_photo_path:K.fotoPath,p_handover:serah});
    if(K.fotoUrl)URL.revokeObjectURL(K.fotoUrl);
    K=K0();J=J0();N=N0();B=B0();S.tab="jual";S.tutup={handover:serah,shift:sid};
    await muatMe().catch(()=>{S.me={...S.me,shift:null}})}
  catch(e){K.pesan=errMsg(e);
    // Jawaban bisa hilang setelah server menutup shift: cocokkan ulang dengan server.
    if(putus(e))await muatMe().catch(()=>{})}
  K.sibuk=false;render()}

/* ---------- Nota: nota shift ini + antrean, ajukan batal ---------- */
const N0=()=>({server:null,galat:"",memuat:false,sel:null,foto:null,fotoMuat:null,batal:null,hapusTap:null});
let N=N0();
const ALASAN=["Salah input","Pelanggan batal","Lainnya"];
const waktuHP=iso=>{const d=new Date(iso);if(isNaN(d))return "";
  return new Intl.DateTimeFormat("id-ID",{timeZone:"Asia/Makassar",hour:"2-digit",minute:"2-digit",hour12:false}).format(d).replace(".",":")};
const lapor=()=>bacaJson("kasir.lapor")||[];
const sudahLapor=id=>lapor().includes(id);
const catatLapor=id=>{const a=lapor();if(!a.includes(id)){a.push(id);tulisJson("kasir.lapor",a.slice(-200))}};
const antreKu=()=>S.antre.filter(it=>S.user&&Antrean.milik(it)===S.user.id).slice().sort((a,b)=>b.dibuat-a.dibuat);
const namaMetode=id=>{const m=cat().methods.find(x=>String(x.id)===String(id));return m?m.name:"-"};
function barisAntre(it){const p=it.payload||{},peta={};
  for(const i of cat().items)for(const v of i.variants||[])peta[v.id]={item:i.name,variant:v.name,price:v.price};
  return (p.lines||[]).map(l=>({qty:l.qty,...(peta[l.variant_id]||{item:"Menu",variant:"",price:0})}))}
const linkLaporWa=t=>CFG.waNomor?"https://wa.me/"+CFG.waNomor+"?text="+encodeURIComponent(t):"";
function teksLaporAntre(it){const p=it.payload||{};
  return ["Nota kasir gagal terkirim ke server.",`Kasir: ${S.me&&S.me.name||""}`,`ID: ${it.id}`,`Waktu di HP: ${p.client_at||"-"}`,
    `Total: ${rp(p.total)} (${namaMetode(p.method_id)})`,...barisAntre(it).map(l=>`${l.qty}× ${l.item} ${l.variant}`),`Alasan: ${it.error}`].join("\n")}
async function muatNota(){if(N.memuat||!S.user)return;N.memuat=true;
  try{N.server=await rpc("pos_my_notas");N.galat=""}
  catch(e){N.galat=putus(e)?"Daftar nota dari server butuh internet.":errMsg(e)}
  N.memuat=false;if(S.screen==="jual"&&S.tab==="nota")render()}
function ketukBaris(tipe,id){N.sel={tipe,id};N.foto=null;N.fotoMuat=null;N.batal=null;N.hapusTap=null;render()}
function vBaris(){const q=antreKu(),sv=N.server||[];
  const baris=[...q.map(it=>{const p=it.payload||{};
      return `<button type="button" class="nota-baris" data-q="${esc(it.id)}"><span><b>${rp(p.total)}</b> · ${esc(namaMetode(p.method_id))}<span class="small muted"> · ${esc(waktuHP(p.client_at))}</span></span>
      <span class="lencana ${it.error?"merah":"kuning"}">${it.error?"Ditolak server":"Belum terkirim"}</span></button>`}),
    ...sv.map(n=>`<button type="button" class="nota-baris" data-n="${esc(n.id)}"><span><b>${esc(n.no)}</b> · ${rp(n.total)}<span class="small muted"> · ${esc(n.method)} · ${esc(waktuHP(n.client_at))}</span></span>
      ${n.status==="batal"?`<span class="lencana abu">Batal</span>`:n.has_void_request?`<span class="lencana kuning">Menunggu persetujuan</span>`:""}</button>`)];
  return baris.length?baris.join(""):(N.memuat?`<p class="muted">Memuat...</p>`:`<p class="muted">Belum ada nota di shift ini.</p>`)}
function vNota(){
  if(N.sel){const d=N.sel.tipe==="server"?vDetailServer():vDetailAntre();if(d)return d;N.sel=null}
  return `<section class="card"><div class="head"><h2>Nota shift ini</h2><button type="button" class="btn sm ghost" id="muat-nota"${N.memuat?" disabled":""}>Muat ulang</button></div>
  ${N.galat?`<p class="err small" role="alert">${esc(N.galat)}</p>`:""}${vBaris()}</section>`}
function vDetailServer(){const n=(N.server||[]).find(x=>x.id===N.sel.id);if(!n)return "";
  const lines=(n.lines||[]).map(l=>`<div class="rg"><span>${esc(l.qty)}× ${esc(l.item)} ${esc(l.variant)}${l.free?" (gratis)":""}</span><span>${rp(l.price*l.qty)}</span></div>`).join("");
  const status=n.status==="batal"?"Batal":n.has_void_request?"Menunggu persetujuan":"Lunas";
  return `<section class="card"><div class="head"><h2>Nota ${esc(n.no)}</h2><button type="button" class="btn sm ghost" id="balik-nota">← Daftar</button></div>
  <p class="small muted">${esc(waktuHP(n.client_at))} · ${esc(n.method)}${n.offline?" · dibuat offline":""}</p>
  ${lines}<div class="total"><span>Total</span><b>${rp(n.total)}</b></div>
  <p>Status: <b id="status-nota">${esc(status)}</b></p>
  ${n.photo_path?(N.foto&&N.foto.id===n.id?(N.foto.url?`<img class="foto-nota" src="${esc(N.foto.url)}" alt="Foto bukti nota">`:`<p class="small muted">Foto tidak bisa dimuat.</p>`):`<p class="small muted">Memuat foto...</p>`):""}
  ${n.status==="lunas"&&!n.has_void_request?(N.batal?vBatal():`<button type="button" class="btn ghost" id="ajukan">Ajukan batal</button>`):""}</section>`}
function vBatal(){const b=N.batal,ok=alasanBatal().length>=5;
  return `<div class="batal"><h3>Alasan batal</h3><div class="metode">${ALASAN.map(a=>`<button type="button" data-alasan="${esc(a)}" aria-pressed="${b.alasan===a}">${esc(a)}</button>`).join("")}</div>
  ${b.alasan==="Lainnya"?`<label for="alasan-teks">Tulis alasan (minimal 5 huruf)<textarea id="alasan-teks" rows="3" maxlength="300">${esc(b.teks)}</textarea></label>`:""}
  <p class="err" id="pesan" role="alert">${esc(b.pesan)}</p>
  <button type="button" class="btn lunas" id="kirim-batal"${ok&&!b.sibuk?"":" disabled"}>Kirim pengajuan</button>
  <button type="button" class="btn ghost" id="batal-x">Tidak jadi</button></div>`}
const alasanBatal=()=>{const b=N.batal;return !b||!b.alasan?"":b.alasan==="Lainnya"?b.teks.trim():b.alasan};
function vDetailAntre(){const it=S.antre.find(x=>x.id===N.sel.id);if(!it)return "";const p=it.payload||{};
  const lines=barisAntre(it).map(l=>`<div class="rg"><span>${esc(l.qty)}× ${esc(l.item)} ${esc(l.variant)}</span><span>${rp(l.price*l.qty)}</span></div>`).join("");
  const lap=sudahLapor(it.id),yakin=N.hapusTap===it.id;
  return `<section class="card"><div class="head"><h2>Nota di HP</h2><button type="button" class="btn sm ghost" id="balik-nota">← Daftar</button></div>
  <p class="small muted">${esc(waktuHP(p.client_at))} · ${esc(namaMetode(p.method_id))}</p>${lines}
  <div class="total"><span>Total</span><b>${rp(p.total)}</b></div>
  ${it.error?`<p class="err" role="alert">Ditolak server: ${esc(it.error)}</p>
    ${linkLaporWa("x")?`<a class="btn" id="lapor" data-lapor="${esc(it.id)}" target="_blank" rel="noopener" href="${esc(linkLaporWa(teksLaporAntre(it)))}">Laporkan ke pemilik</a>`:`<p class="small muted">Nomor pemilik belum diatur. Hubungi pemilik langsung.</p>`}
    <button type="button" class="btn ${yakin?"":"ghost"}" id="hapus-hp"${lap?"":" disabled"}>${yakin?"Yakin? Ketuk lagi untuk menghapus":"Hapus dari HP"}</button>
    ${lap||!linkLaporWa("x")?"":`<p class="small muted">Laporkan ke pemilik dulu, baru nota ini bisa dihapus dari HP.</p>`}`
   :`<p class="antre">Belum terkirim. Akan terkirim otomatis saat ada internet.</p>`}</section>`}
async function muatFoto(n){if(N.fotoMuat===n.id)return;N.fotoMuat=n.id;let url=null;
  try{const r=await S.sb.storage.from("bukti").createSignedUrl(n.photo_path,300);if(!r.error&&r.data)url=r.data.signedUrl}catch(e){}
  if(N.sel&&N.sel.id===n.id){N.foto={id:n.id,url};if(S.tab==="nota")render()}}
function bindNota(){
  const mn=$("muat-nota");if(mn)mn.onclick=()=>muatNota();
  document.querySelectorAll("[data-n]").forEach(b=>b.onclick=()=>ketukBaris("server",b.dataset.n));
  document.querySelectorAll("[data-q]").forEach(b=>b.onclick=()=>ketukBaris("antre",b.dataset.q));
  const bk=$("balik-nota");if(bk)bk.onclick=()=>{N.sel=null;N.batal=null;N.hapusTap=null;render()};
  if(N.sel&&N.sel.tipe==="server"){const n=(N.server||[]).find(x=>x.id===N.sel.id);if(n&&n.photo_path)muatFoto(n)}
  const aj=$("ajukan");if(aj)aj.onclick=()=>{N.batal={alasan:"",teks:"",pesan:"",sibuk:false};render()};
  document.querySelectorAll("[data-alasan]").forEach(b=>b.onclick=()=>{N.batal.alasan=b.dataset.alasan;N.batal.pesan="";render()});
  const at=$("alasan-teks");if(at)at.oninput=()=>{N.batal.teks=at.value;$("kirim-batal").disabled=alasanBatal().length<5};
  const bx=$("batal-x");if(bx)bx.onclick=()=>{N.batal=null;render()};
  const kb=$("kirim-batal");if(kb)kb.onclick=async()=>{if(N.batal.sibuk||alasanBatal().length<5)return;N.batal.sibuk=true;kb.disabled=true;
    try{await rpc("pos_void_request",{p_nota:N.sel.id,p_reason:alasanBatal()});N.batal=null;
      N.server=await rpc("pos_my_notas")}
    catch(e){if(N.batal){N.batal.pesan=errMsg(e);N.batal.sibuk=false}}
    render()};
  const hp=$("hapus-hp");if(hp)hp.onclick=async()=>{const id=N.sel.id;if(!sudahLapor(id))return;
    if(N.hapusTap!==id){N.hapusTap=id;render();return}
    try{await Antrean.hapus(id)}catch(e){toast(errMsg(e));return}
    N.sel=null;N.hapusTap=null;await segarBilah();render()}}

/* ---------- Tab bawah (daftar bisa ditambah, mis. tab pemilik) ---------- */
const TAB=[["jual","Jual"],["nota","Nota"],["kas","Kas"]];
function renderTab(){let n=$("tab");
  if(!n){n=document.createElement("nav");n.id="tab";n.className="tab";n.setAttribute("aria-label","Menu kasir");document.body.appendChild(n)}
  const tampil=S.screen==="jual"&&!!S.me&&!!S.me.shift;n.hidden=!tampil;document.body.classList.toggle("ada-tab",tampil);
  if(!tampil){n.innerHTML="";return}
  n.innerHTML=TAB.map(t=>`<button type="button" data-tab="${t[0]}"${S.tab===t[0]?' aria-current="page"':""}>${t[1]}</button>`).join("");
  n.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>pindahTab(b.dataset.tab))}
async function pindahTab(t){if(S.tab===t)return;S.tab=t;N.sel=null;N.batal=null;N.hapusTap=null;
  await segarBilah();
  render();if(t==="nota")muatNota()}
document.addEventListener("click",e=>{const a=e.target.closest&&e.target.closest("a[data-lapor]");
  if(a){catatLapor(a.dataset.lapor);setTimeout(()=>{if(S.screen==="jual"&&S.tab==="nota")render()},0)}},true);

function vPutus(){return `<div class="head"><h1>Kasir</h1></div><section class="card"><h2>Koneksi internet bermasalah</h2>
  <p class="muted">Belum bisa memeriksa akun dan HP ini. Periksa sinyal, lalu coba lagi.</p><button type="button" class="btn" id="ulang">Coba lagi</button></section>`}
function bindPutus(){$("ulang").onclick=()=>mulai("")}

function render(){const app=$("app");
  if(!S.sb){app.innerHTML=`<section class="card"><h2>Belum disambungkan</h2><p class="muted">Isi <code>kasir/config.js</code> dengan Project URL dan kunci publishable Supabase.</p></section>`;return}
  const V={masuk:[vMasuk,bindMasuk],tunggu:[vTunggu,bindTunggu],jual:[vJual,bindJual],putus:[vPutus,bindPutus]}[S.screen];
  app.innerHTML=V[0]();V[1]();const o=$("out");if(o)o.onclick=()=>keluar(false);renderBilah();renderTab()}

/* ---------- Alur ---------- */
async function muatMe(){S.me=await rpc("pos_me",{p_device:S.device});
  if(S.me.device==="approved"){S.catalog=await rpc("pos_catalog");S.screen="jual"}else S.screen="tunggu";
  simpanSiap()}
async function mulai(nama){S.device=deviceId();
  try{await rpc("pos_device_request",{p_device:S.device,p_label:((nama?nama+" · ":"")+labelUA()).slice(0,80)});
    localStorage.setItem("kasir.device.diminta","1");await muatMe()}
  catch(err){if(putus(err)){const o=siapOffline();  // jangan keluarkan kasir hanya karena sinyal
      if(o){Object.assign(S,o,{screen:"jual"});aktif=Date.now();render();kirimAntrean();return}
      S.screen="putus";render();return}
    const m=errMsg(err);await keluar(true);galat=m==="Khusus kasir"?"Akun ini bukan staf toko. Minta pemilik menambahkan emailmu.":m;render();return}
  aktif=Date.now();render();kirimAntrean()}
// otomatis=true: dipanggil sistem (diam/gagal masuk). Keluar manual ditolak selama antrean belum kosong.
async function keluar(otomatis){const n=await antrean();
  if(n>0){if(!otomatis)toast(`Masih ada ${n} nota belum terkirim. Sambungkan internet dulu.`);return}
  const r=await S.sb.auth.signOut().catch(e=>({error:e}));
  if(r&&r.error)await S.sb.auth.signOut({scope:"local"}).catch(()=>{});
  localStorage.removeItem("kasir.me");
  Object.assign(S,{user:null,me:null,catalog:null,screen:"masuk",antre:[],tab:"jual",tutup:null});J=J0();K=K0();N=N0();B=B0();galat="";render()}

/* ---------- Logout otomatis ---------- */
let aktif=Date.now();
["pointerdown","keydown"].forEach(ev=>addEventListener(ev,()=>{aktif=Date.now()},{capture:true,passive:true}));
let cekDiamJalan=false;
async function cekDiam(){if(cekDiamJalan||!S.user||Date.now()-aktif<DIAM_MAKS)return;cekDiamJalan=true;
  try{if(await antrean()>0)return;await keluar(true);if(!S.user)toast("Keluar otomatis: 30 menit tidak dipakai.")}
  finally{cekDiamJalan=false}}
setInterval(cekDiam,30*1000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)cekDiam()});

/* ---------- Antrean offline & bilah status ---------- */
// Pemicu: aplikasi dibuka, event online, dan tiap 30 detik selama ada nota menunggu.
// Tidak jalan saat Lunas sedang berproses (Lunas mengirim sendiri dan butuh hasilnya).
async function kirimAntrean(){if(!S.user||J.sibuk)return;
  try{terapkanHasil(await Antrean.kirimSemua(S.sb,{uid:S.user.id}))}catch(e){}
  await segarBilah()}
// Nota yang sedang tampil di layar Selesai sebagai "Tersimpan di HP" sudah sampai: tampilkan nomor dari server.
function terapkanHasil(r){const s=J.selesai,ok=s&&s.antre&&r&&r.hasil[s.id];
  if(!ok)return;Object.assign(s,{hasil:ok.hasil,kode:ok.kode,antre:false});s.teks=teksSelesai(s);if(J.tahap==="selesai")render()}
let sidikAntre="";
async function segarBilah(){try{S.antre=await Antrean.daftar()}catch(e){S.antre=[]}renderBilah();
  // Isi antrean berubah (terkirim/ditolak): perbarui daftar Nota bila sedang terbuka.
  const sidik=S.antre.map(it=>it.id+(it.error?"!":"")).join();
  if(sidik!==sidikAntre){sidikAntre=sidik;if(S.screen==="jual"&&S.tab==="nota"&&!N.sel&&!N.memuat)muatNota()}}
function linkLapor(it){const p=it.payload||{};
  const t=["Nota kasir gagal terkirim ke server.",`ID: ${it.id}`,`Waktu di HP: ${p.client_at||"-"}`,`Total: ${rp(p.total)}`,`Alasan: ${it.error}`].join("\n");
  return linkLaporWa(t)}
function renderBilah(){const b=$("bilah");if(!S.user){b.hidden=true;return}
  const on=daring(),punyaku=it=>Antrean.milik(it)===S.user.id;
  const n=S.antre.filter(it=>!it.error&&punyaku(it)).length,lain=S.antre.filter(it=>!it.error&&!punyaku(it)).length;
  const gagal=S.antre.filter(it=>it.error);
  b.hidden=false;b.className="bilah "+(on?"on":"off");
  b.innerHTML=`<p><span class="titik" aria-hidden="true"></span>${on?"Online":"Offline"}${n?` · ${n} nota menunggu`:""}</p>
  ${lain?`<p class="small">${lain} nota milik kasir lain menunggu. Terkirim saat kasir itu masuk di HP ini.</p>`:""}
  ${gagal.map(it=>`<div class="gagal"><p class="small">Nota ${esc(rp(it.payload&&it.payload.total))} ditolak server: ${esc(it.error)}</p>
    ${linkLapor(it)?`<a class="btn sm" data-lapor="${esc(it.id)}" target="_blank" rel="noopener" href="${esc(linkLapor(it))}">Laporkan ke pemilik</a>`:""}</div>`).join("")}`}
function ubahSinyal(){renderBilah();if(S.screen==="jual"&&J.tahap==="bayar"&&!J.sibuk)render()}
addEventListener("online",()=>{ubahSinyal();kirimAntrean()});
addEventListener("offline",ubahSinyal);
setInterval(()=>{if(S.user&&S.antre.some(it=>!it.error&&Antrean.milik(it)===S.user.id))kirimAntrean()},30*1000);

// Sesi tersimpan di HP (dipakai saat offline, tanpa menunggu percobaan refresh token).
const userTersimpan=()=>{const a=bacaJson("kasir-auth");return a&&a.user||null};
async function boot(){if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
  // Minta browser tidak membersihkan antrean (IndexedDB) saat ruang HP menipis.
  if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(()=>{});
  if(!CFG.supabaseUrl||!CFG.supabaseKey||!window.supabase){render();return}
  S.sb=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true,storageKey:"kasir-auth"}});
  if(!daring()&&userTersimpan())S.user=userTersimpan();
  else{const {data,error}=await S.sb.auth.getSession();S.user=data.session&&data.session.user;
    if(!S.user&&error&&putus(error))S.user=userTersimpan()}
  if(S.user)await mulai("");else render()}
boot();
})();
