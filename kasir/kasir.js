/* Kasir Tjap Dua Koi: login staf, persetujuan perangkat, logout otomatis, layar jual. */
(function(){
"use strict";
const CFG=window.KASIR_CONFIG||{};
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(m){const t=$("toast");t.textContent=m;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(()=>t.hidden=true,3200)}
const putus=e=>/Failed to fetch|NetworkError|Load failed/i.test((e&&e.message)||String(e));
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

// Layar jual: kerangka; keranjang & bayar menyusul (Task 9).
function vJual(){const items=(S.catalog&&S.catalog.items)||[];
  return `<div class="head"><h1>Kasir</h1><button type="button" class="btn sm ghost" id="out">Keluar</button></div>
  <p class="small muted">${esc(S.me.name||S.user.email)}</p>
  <section class="card"><h2>Menu</h2>${items.length?`<div class="menu">${items.map(i=>`<button type="button" data-item="${i.id}">${esc(i.name)}</button>`).join("")}</div>`:`<p class="muted">Belum ada menu. Pemilik menambah menu di halaman pengaturan.</p>`}</section>`}
function bindJual(){}

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
  Object.assign(S,{user:null,me:null,catalog:null,screen:"masuk"});galat="";render()}

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
