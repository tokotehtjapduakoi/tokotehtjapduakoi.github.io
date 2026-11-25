/* Layar pemilik Kasir Tjap Dua Koi: Laporan, Setujui (batal + perangkat), Atur (menu, metode, diskon, perangkat, staf),
   dan verifikasi 2 langkah. Dimuat sesudah kasir.js dan memakai window.KasirApp. Semua RPC lewat sb.rpc, tanpa sb.from().
   Tab pemilik: Jual · Laporan · Setujui · Atur. Kas dan Nota tetap bisa dibuka dari Atur ("Laci kas" / "Nota shift ini"). */
(function(){
"use strict";
const A=window.KasirApp,S=A.S,esc=A.esc,rp=A.rp;
const CFG=window.KASIR_CONFIG||{};
const digit=s=>String(s||"").replace(/\D/g,"");
const $=id=>document.getElementById(id);
const OWNER_TABS=["laporan","setujui","atur"];
const P0=()=>({
  lap:{day:null,data:null,memuat:false,galat:""},
  set:{void:[],dev:[],memuat:false,galat:"",yakin:null,hasil:[],foto:{}},
  atur:{sec:"menu",cat:null,devs:[],memuat:false,galat:"",yakin:null},
  mfa:{tahap:null,faktor:null,enroll:null,kode:"",pesan:"",sibuk:false},
  badge:0});
let P=P0();
const mfaOk=()=>!!(S.me&&S.me.mfa);
const ini=()=>S.tab; // tab yang sedang tampil
const segar=tab=>{if(S.screen==="jual"&&S.tab===tab)A.render()};

/* ---------- Verifikasi 2 langkah (TOTP) ---------- */
async function muatMfa(){const m=P.mfa;if(m.tahap)return;m.tahap="memuat";
  try{const {data,error}=await S.sb.auth.mfa.listFactors();if(error)throw error;
    const ada=(data.totp||[])[0];
    // faktor yang dulu didaftarkan tetapi belum pernah dibuktikan dibuang supaya pendaftaran bisa diulang
    for(const f of (data.all||[]))if(f.factor_type==="totp"&&f.status==="unverified")await S.sb.auth.mfa.unenroll({factorId:f.id}).catch(()=>{});
    m.faktor=ada?ada.id:null;m.tahap=ada?"kode":"belum"}
  catch(e){m.tahap=null;m.pesan=A.errMsg(e)}
  segar(ini())}
async function mulaiDaftar(){const m=P.mfa;if(m.sibuk)return;m.sibuk=true;m.pesan="";A.render();
  try{const {data,error}=await S.sb.auth.mfa.enroll({factorType:"totp",friendlyName:"Kasir "+new Date().toISOString().slice(0,16)});
    if(error)throw error;m.enroll={id:data.id,qr:data.totp.qr_code,secret:data.totp.secret};m.tahap="daftar"}
  catch(e){m.pesan=A.errMsg(e)}
  m.sibuk=false;A.render()}
async function kirimKode(){const m=P.mfa;if(m.sibuk||m.kode.length!==6)return;m.sibuk=true;m.pesan="";A.render();
  try{let r;
    if(m.tahap==="daftar"){const c=await S.sb.auth.mfa.challenge({factorId:m.enroll.id});if(c.error)throw c.error;
      r=await S.sb.auth.mfa.verify({factorId:m.enroll.id,challengeId:c.data.id,code:m.kode})}
    else r=await S.sb.auth.mfa.challengeAndVerify({factorId:m.faktor,code:m.kode});
    if(r.error)throw r.error;
    const f=await S.sb.auth.refreshSession();if(f.error)throw f.error;
    await A.muatMe();P.mfa=P0().mfa;
    if(!mfaOk())throw new Error("Verifikasi belum diterima server. Coba lagi.");
    masuk(S.tab);sesudahMe()}
  catch(e){m.pesan=/invalid|expired|code/i.test(e.message||"")?"Kode salah atau sudah kedaluwarsa. Coba kode yang baru.":A.errMsg(e);m.kode="";}
  m.sibuk=false;A.render()}
function vMfa(){const m=P.mfa;
  const pesan=`<p class="err" role="alert">${esc(m.pesan)}</p>`;
  const kode=`<label for="mfa-kode">Kode 6 angka dari aplikasi autentikator<input id="mfa-kode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" value="${esc(m.kode)}"></label>${pesan}
    <button type="button" class="btn" id="mfa-kirim"${m.kode.length===6&&!m.sibuk?"":" disabled"}>Verifikasi</button>`;
  const kepala=`<h2>Verifikasi 2 langkah</h2>`;
  if(m.tahap==="daftar"&&m.enroll)return `<section class="card">${kepala}
    <p class="muted">Pindai gambar ini dengan aplikasi autentikator (Google Authenticator, Authy, dan sejenisnya), lalu ketik kode 6 angkanya.</p>
    <div class="qr"><img src="${esc(m.enroll.qr)}" alt="QR verifikasi 2 langkah" width="220" height="220"></div>
    <p class="small muted">Tidak bisa memindai? Ketik kode rahasia ini di aplikasi: <span class="kode" id="mfa-rahasia">${esc(m.enroll.secret)}</span></p>${kode}</section>`;
  if(m.tahap==="kode")return `<section class="card">${kepala}<p class="muted">Menu pemilik butuh kode dari aplikasi autentikator.</p>${kode}</section>`;
  if(m.tahap==="belum")return `<section class="card">${kepala}
    <p class="muted">Menu pemilik (Setujui dan Atur) wajib memakai verifikasi 2 langkah. Pasang sekali saja di HP ini.</p>${pesan}
    <button type="button" class="btn" id="mfa-daftar"${m.sibuk?" disabled":""}>Pasang verifikasi 2 langkah</button></section>`;
  return `<section class="card">${kepala}<p class="muted">${m.tahap==="memuat"?"Memeriksa...":"Belum bisa memeriksa verifikasi."}</p>${m.tahap?"":pesan+`<button type="button" class="btn" id="mfa-ulang">Coba lagi</button>`}</section>`}
function bindMfa(){const k=$("mfa-kode");
  if(k){k.oninput=()=>{P.mfa.kode=digit(k.value).slice(0,6);k.value=P.mfa.kode;$("mfa-kirim").disabled=P.mfa.kode.length!==6||P.mfa.sibuk};k.focus()}
  const b=$("mfa-kirim");if(b)b.onclick=kirimKode;
  const d=$("mfa-daftar");if(d)d.onclick=mulaiDaftar;
  const u=$("mfa-ulang");if(u)u.onclick=()=>{P.mfa.tahap=null;P.mfa.pesan="";muatMfa()}}

/* ---------- Laporan ---------- */
async function muatLaporan(day){const L=P.lap;L.memuat=true;L.galat="";if(day!==undefined)L.day=day;
  try{L.data=await A.rpc("pos_report",L.day?{p_day:L.day}:{});L.day=L.data.day}
  catch(e){L.galat=A.errMsg(e)}
  L.memuat=false;segar("laporan")}
const daftarBaris=(arr,fn)=>arr&&arr.length?arr.map(fn).join(""):`<p class="small muted">Belum ada.</p>`;
const baris=(a,b)=>`<div class="rg"><span>${a}</span><span>${b}</span></div>`;
const tanda=n=>(n<0?"−":"+")+rp(Math.abs(n));
function peringatan(d){const w=[];
  for(const v of d.voids||[])w.push(`Nota <s class="coret">${esc(v.no)}</s> dibatalkan (${rp(v.total)}). Alasan: ${esc(v.reason)}. Diajukan ${esc(v.by||"-")}, disetujui ${esc(v.approved_by||"-")}.`);
  if(d.pending_voids>0)w.push(`${esc(d.pending_voids)} pengajuan batal menunggu keputusanmu di tab Setujui.`);
  for(const m of (d.offline&&d.offline.mismatch)||[])w.push(`Nota offline ${esc(m.no)} beda harga: di HP ${rp(m.total)}, hitungan server ${rp(m.server_total)}.`);
  if(d.offline&&d.offline.held>0)w.push(`${esc(d.offline.held)} nota ditahan (kode klaim belum aktif).`);
  for(const s of d.shifts||[]){const nm=esc(s.cashier||"Kasir");
    if(s.selisih!=null&&s.selisih!==0)w.push(`Selisih kas shift ${nm}: ${esc(tanda(s.selisih))} (hitungan ${rp(s.counted)}, seharusnya ${rp(s.expected)}).`);
    if(s.selisih_terima!=null&&s.selisih_terima!==0)w.push(`Selisih saat terima laci (kasir penerima setelah ${nm}): ${esc(tanda(s.selisih_terima))}.`);
    if(s.start_mismatch)w.push(`Modal awal shift ${nm} tidak sama dengan hitungan penutupan shift sebelumnya.`)}
  for(const x of d.suspicious||[])w.push(`Nota ${esc(x.no)}: ${esc(x.reason)}.`);
  return w}
function vLaporan(){const L=P.lap,d=L.data;
  const pilih=`<label for="lap-hari">Tanggal<input id="lap-hari" type="date" value="${esc(L.day||"")}"></label>`;
  const kepala=`<section class="card"><div class="head"><h2>Laporan</h2><button type="button" class="btn sm ghost" id="lap-muat"${L.memuat?" disabled":""}>Muat ulang</button></div>${pilih}
    ${L.galat?`<p class="err" role="alert">${esc(L.galat)}</p>`:""}</section>`;
  if(!d)return kepala+(L.memuat?`<p class="muted tengah">Memuat...</p>`:"");
  const w=peringatan(d);
  return kepala+`<section class="card"><div class="angka"><div><span class="small muted">Omzet</span><b id="lap-omzet">${rp(d.omzet)}</b></div>
    <div><span class="small muted">Nota</span><b id="lap-nota">${esc(d.notas)}</b></div><div><span class="small muted">Rata-rata</span><b>${rp(d.avg)}</b></div></div>
    ${d.discounts&&d.discounts.count?`<p class="small muted">Diskon: ${esc(d.discounts.count)} nota, total ${rp(d.discounts.total)}</p>`:""}</section>
  ${w.length?`<section class="card peringatan" role="alert"><h2>Perlu diperhatikan</h2>${w.map(x=>`<p class="warn">${x}</p>`).join("")}</section>`:""}
  <section class="card"><h3>Per metode bayar</h3>${daftarBaris(d.by_method,m=>baris(`${esc(m.name)} · ${esc(m.count)} nota`,rp(m.total)))}</section>
  <section class="card"><h3>Per kasir</h3>${daftarBaris(d.by_cashier,c=>baris(`${esc(c.name||"-")} · ${esc(c.count)} nota`,rp(c.total)))}</section>
  <section class="card"><h3>Menu terlaris</h3>${daftarBaris(d.top_items,t=>baris(`${esc(t.item)} ${esc(t.variant)} × ${esc(t.qty)}`,rp(t.total)))}</section>
  <section class="card"><h3>Shift</h3>${daftarBaris(d.shifts,s=>baris(`${esc(s.cashier||"-")} · ${esc(A.waktuHP(s.opened_at))}${s.closed_at?"–"+esc(A.waktuHP(s.closed_at)):" (berjalan)"}`,
      s.counted==null?"belum ditutup":`hitung ${rp(s.counted)} / seharusnya ${rp(s.expected)}`))}</section>
  <section class="card"><h3>Kode klaim kartu</h3>${baris("Diterbitkan",esc(d.codes.issued))}${baris("Sudah diklaim",esc(d.codes.claimed))}${baris("Kedaluwarsa belum diklaim",esc(d.codes.expired_unclaimed))}
    ${d.storage_mb!=null?`<p class="small muted">Foto bukti memakai ${esc(d.storage_mb)} MB.</p>`:""}</section>`}
function bindLaporan(){const h=$("lap-hari");if(h)h.onchange=()=>{if(h.value)muatLaporan(h.value)};
  const m=$("lap-muat");if(m)m.onclick=()=>muatLaporan()}

/* ---------- Setujui: pengajuan batal + perangkat menunggu ---------- */
const bukaFoto=async n=>{const f=P.set.foto;if(!n.photo_path||n.nota_id in f)return;f[n.nota_id]=null;let url=false;
  try{const r=await S.sb.storage.from("bukti").createSignedUrl(n.photo_path,300);if(!r.error&&r.data)url=r.data.signedUrl}catch(e){}
  f[n.nota_id]=url;segar("setujui")};
async function muatSetuju(){const T=P.set;T.memuat=true;T.galat="";
  try{[T.void,T.dev]=await Promise.all([A.rpc("pos_void_pending"),A.rpc("pos_devices_list")]);T.dev=T.dev.filter(d=>d.status==="pending");
    hitungBadge();T.void.forEach(bukaFoto)}
  catch(e){T.galat=A.errMsg(e)}
  T.memuat=false;segar("setujui");A.renderTab()}
function hitungBadge(){P.badge=P.set.void.length+P.set.dev.length}
function vVoid(n){const T=P.set,k="v"+n.id,f=T.foto[n.nota_id];
  const yakin=T.yakin&&T.yakin.k===k?T.yakin.setuju:null;
  return `<section class="card kartu-void" data-nota="${esc(n.no)}"><div class="head"><h3>Nota ${esc(n.no)}</h3><b>${rp(n.total)}</b></div>
  <p class="small muted">${esc(n.cashier||"Kasir")} · ${esc(A.waktuHP(n.client_at))} · ${esc(n.method)}</p>
  ${(n.lines||[]).map(l=>baris(`${esc(l.qty)}× ${esc(l.item)} ${esc(l.variant)}${l.free?" (gratis)":""}`,rp(l.price*l.qty))).join("")}
  <p><b>Alasan:</b> ${esc(n.reason)}</p>
  ${n.claimed?`<p class="warn">Kode klaim sudah dipakai member${n.pulls?` (${esc(n.pulls)} kartu ditarik)`:""}. Menyetujui akan menarik kartunya kembali.</p>`:""}
  ${f?`<img class="foto-nota" src="${esc(f)}" alt="Foto bukti nota ${esc(n.no)}">`:n.photo_path?`<p class="small muted">${f===false?"Foto tidak bisa dimuat.":"Memuat foto..."}</p>`:""}
  <div class="aksi2"><button type="button" class="btn${yakin===true?"":" ghost"}" data-void="${esc(n.id)}" data-setuju="1">${yakin===true?"Yakin setujui batal? Ketuk lagi":"Setujui"}</button>
  <button type="button" class="btn${yakin===false?" lunas":" ghost"}" data-void="${esc(n.id)}" data-setuju="0">${yakin===false?"Yakin tolak? Ketuk lagi":"Tolak"}</button></div></section>`}
const devKode=id=>id.slice(0,4).toUpperCase()+"-"+id.slice(4,8).toUpperCase();
function vDev(d,tolak){return `<div class="baris"><div><b>${esc(d.label||"Perangkat")}</b>${d.id===S.device?" (HP ini)":""}<div class="small muted kode">${esc(devKode(d.id))}</div></div>${tolak}</div>`}
function vSetuju(){const T=P.set;
  return `<section class="card"><div class="head"><h2>Setujui</h2><button type="button" class="btn sm ghost" id="set-muat"${T.memuat?" disabled":""}>Muat ulang</button></div>
  ${T.galat?`<p class="err" role="alert">${esc(T.galat)}</p>`:""}</section>
  ${T.hasil.map(h=>`<section class="card hasil" role="status"><p><b>${esc(h.teks)}</b></p>${h.hilang&&h.hilang.length?`<p class="warn" id="kartu-hilang">Kartu sudah tidak ada di inventori member: ${esc(h.hilang.join(", "))}. Periksa manual.</p>`:""}</section>`).join("")}
  <h3>Pengajuan batal (${T.void.length})</h3>${T.void.length?T.void.map(vVoid).join(""):`<p class="muted">${T.memuat?"Memuat...":"Tidak ada pengajuan."}</p>`}
  <h3>Perangkat menunggu (${T.dev.length})</h3>${T.dev.length?T.dev.map(d=>vDev(d,`<div class="qty"><button type="button" class="btn sm" data-dev="${esc(d.id)}" data-setuju="1" aria-label="Setujui perangkat ${esc(d.label||devKode(d.id))}">Setujui</button>
    <button type="button" class="btn sm ghost" data-dev="${esc(d.id)}" data-setuju="0" aria-label="Tolak perangkat ${esc(d.label||devKode(d.id))}">Tolak</button></div>`)).join(""):`<p class="muted">${T.memuat?"Memuat...":"Tidak ada perangkat menunggu."}</p>`}`}
async function putusVoid(id,setuju){const T=P.set,n=T.void.find(x=>String(x.id)===String(id));if(!n)return;
  try{const r=await A.rpc("pos_void_decide",{p_req:Number(id),p_approve:setuju});
    T.hasil.unshift({teks:r.approved?`Nota ${n.no} dibatalkan.`:`Pengajuan batal nota ${n.no} ditolak.`,hilang:r.cards_missing||[]});
    T.hasil=T.hasil.slice(0,5);T.yakin=null;P.lap.data=null;await muatSetuju()}
  catch(e){T.galat=A.errMsg(e);T.yakin=null;A.render()}}
async function putusDev(id,setuju){try{await A.rpc("pos_device_decide",{p_device:id,p_approve:setuju});
    await A.muatMe();await Promise.all([muatSetuju(),P.atur.cat?muatAtur():0])}
  catch(e){P.set.galat=A.errMsg(e);A.render()}}
function bindSetuju(){const m=$("set-muat");if(m)m.onclick=()=>muatSetuju();
  document.querySelectorAll("[data-void]").forEach(b=>b.onclick=()=>{const k="v"+b.dataset.void,setuju=b.dataset.setuju==="1",y=P.set.yakin;
    if(y&&y.k===k&&y.setuju===setuju){b.disabled=true;putusVoid(b.dataset.void,setuju)}else{P.set.yakin={k,setuju};A.render()}});
  document.querySelectorAll("[data-dev]").forEach(b=>b.onclick=()=>{b.disabled=true;putusDev(b.dataset.dev,b.dataset.setuju==="1")})}

/* ---------- Atur ---------- */
const SEKSI=[["menu","Menu"],["metode","Metode bayar"],["diskon","Diskon"],["perangkat","Perangkat"],["staf","Staf"]];
async function muatAtur(){const G=P.atur;G.memuat=true;G.galat="";
  try{[G.cat,G.devs]=await Promise.all([A.rpc("pos_catalog_all"),A.rpc("pos_devices_list")])}
  catch(e){G.galat=A.errMsg(e)}
  G.memuat=false;segar("atur")}
// Simpan lewat RPC, lalu muat ulang daftar Atur dan katalog kasir (supaya tab Jual memakai harga baru).
async function simpan(fn,p,teks){const G=P.atur;G.galat="";
  try{await A.rpc(fn,{p});await Promise.all([muatAtur(),A.muatMe()]);A.toast(teks||"Tersimpan.")}
  catch(e){G.galat=A.errMsg(e);A.render()}}
const nilai=id=>{const e=$(id);return e?e.value.trim():""};
const toggle=(attr,id,aktif)=>`<button type="button" class="btn sm ghost" ${attr}="${esc(id)}" data-aktif="${aktif?"0":"1"}">${aktif?"Nonaktifkan":"Aktifkan"}</button>`;
const lencanaOff=a=>a?"":` <span class="lencana abu">Nonaktif</span>`;
function vMenuAtur(c){return c.items.map(i=>`<section class="card"><div class="head"><h3>${esc(i.name)}${lencanaOff(i.active)}</h3>${toggle("data-item",i.id,i.active)}</div>
  ${i.category?`<p class="small muted">${esc(i.category)}</p>`:""}
  ${i.variants.map(v=>`<div class="baris-atur"><span class="nama">${esc(v.name)}${lencanaOff(v.active)}</span>
    <input id="hrg-${esc(v.id)}" inputmode="numeric" autocomplete="off" value="${esc(v.price)}" aria-label="Harga ${esc(i.name)} ${esc(v.name)}">
    <button type="button" class="btn sm" data-harga="${esc(v.id)}" aria-label="Simpan harga ${esc(i.name)} ${esc(v.name)}">Simpan</button>
    ${toggle("data-var",v.id,v.active)}</div>`).join("")||`<p class="small muted">Belum ada ukuran.</p>`}
  <div class="baris-atur"><input id="vn-${esc(i.id)}" autocomplete="off" placeholder="Ukuran baru" aria-label="Nama ukuran baru ${esc(i.name)}">
    <input id="vh-${esc(i.id)}" inputmode="numeric" autocomplete="off" placeholder="Harga" aria-label="Harga ukuran baru ${esc(i.name)}">
    <button type="button" class="btn sm ghost" data-tambah-var="${esc(i.id)}" aria-label="Tambah ukuran ${esc(i.name)}">Tambah</button></div></section>`).join("")
  +`<section class="card"><h3>Menu baru</h3><label for="im-nama">Nama menu<input id="im-nama" autocomplete="off"></label>
  <label for="im-kat">Kategori<input id="im-kat" autocomplete="off" placeholder="mis. Minuman"></label>
  <button type="button" class="btn" id="im-tambah">Tambah menu</button></section>`}
const jenisMetode=k=>({tunai:"Tunai",qris:"QRIS",transfer:"Transfer"}[k]||k);
function vMetodeAtur(c){return `<section class="card"><h3>Metode bayar</h3>${c.methods.map(m=>`<div class="baris"><span>${esc(m.name)} <span class="small muted">(${esc(jenisMetode(m.kind))})</span>${lencanaOff(m.active)}</span>${toggle("data-metode",m.id,m.active)}</div>`).join("")}</section>
  <section class="card"><h3>Metode baru</h3><label for="mt-nama">Nama<input id="mt-nama" autocomplete="off"></label>
  <label for="mt-jenis">Jenis<select id="mt-jenis"><option value="tunai">Tunai</option><option value="qris">QRIS</option><option value="transfer">Transfer</option></select></label>
  <button type="button" class="btn" id="mt-tambah">Tambah metode</button></section>`}
const teksDiskon=d=>d.kind==="persen"?esc(d.value)+"%":rp(d.value);
function vDiskonAtur(c){return `<section class="card"><h3>Diskon</h3>${c.discounts.length?c.discounts.map(d=>`<div class="baris"><span>${esc(d.name)} <span class="small muted">(${teksDiskon(d)})</span>${lencanaOff(d.active)}</span>${toggle("data-diskon",d.id,d.active)}</div>`).join(""):`<p class="muted">Belum ada diskon.</p>`}</section>
  <section class="card"><h3>Diskon baru</h3><label for="dk-nama">Nama<input id="dk-nama" autocomplete="off"></label>
  <label for="dk-jenis">Jenis<select id="dk-jenis"><option value="persen">Persen (%)</option><option value="rupiah">Rupiah</option></select></label>
  <label for="dk-nilai">Nilai<input id="dk-nilai" inputmode="numeric" autocomplete="off"></label>
  <button type="button" class="btn" id="dk-tambah">Tambah diskon</button></section>`}
const statusDev={approved:"Disetujui",pending:"Menunggu",revoked:"Dicabut"};
function vPerangkatAtur(){const G=P.atur;
  return `<section class="card"><h3>Perangkat</h3>${G.devs.length?G.devs.map(d=>{const yakin=G.yakin===d.id;
    return vDev(d,`<div class="qty"><span class="lencana ${d.status==="approved"?"":"kuning"}">${esc(statusDev[d.status]||d.status)}</span>${d.status==="approved"
      ?`<button type="button" class="btn sm ghost" data-cabut="${esc(d.id)}" aria-label="Cabut perangkat ${esc(d.label||devKode(d.id))}">${yakin?"Yakin? Ketuk lagi":"Cabut"}</button>`
      :`<button type="button" class="btn sm" data-dev-atur="${esc(d.id)}" aria-label="Setujui perangkat ${esc(d.label||devKode(d.id))}">Setujui</button>`}</div>`)}).join(""):`<p class="muted">Belum ada perangkat.</p>`}</section>`}
function vStafAtur(){const u=(CFG.kolamUrl||"")+"admin/";
  return `<section class="card"><h3>Staf</h3><p class="muted">Menambah atau mengubah kasir dilakukan di Admin Kolam Koi.</p>
  ${CFG.kolamUrl?`<a class="btn" id="staf-link" href="${esc(u)}" target="_blank" rel="noopener">Buka Admin Kolam Koi</a>`:`<p class="small muted">Alamat Kolam Koi belum diatur.</p>`}</section>`}
function vAtur(){const G=P.atur,c=G.cat;
  const tabs=`<div class="metode" role="group" aria-label="Bagian pengaturan">${SEKSI.map(s=>`<button type="button" data-seksi="${s[0]}" aria-pressed="${G.sec===s[0]}">${s[1]}</button>`).join("")}</div>`;
  const laci=S.me.shift?`<div class="aksi2"><button type="button" class="btn ghost" id="ke-kas">Laci kas</button><button type="button" class="btn ghost" id="ke-nota">Nota shift ini</button></div>`:"";
  const kepala=`<section class="card"><div class="head"><h2>Atur</h2><button type="button" class="btn sm ghost" id="atur-muat"${G.memuat?" disabled":""}>Muat ulang</button></div>${tabs}${laci}
    ${G.galat?`<p class="err" role="alert">${esc(G.galat)}</p>`:""}</section>`;
  if(!c)return kepala+`<p class="muted tengah">${G.memuat?"Memuat...":""}</p>`;
  return kepala+({menu:vMenuAtur,metode:vMetodeAtur,diskon:vDiskonAtur,perangkat:vPerangkatAtur,staf:vStafAtur}[G.sec])(c)}
function bindAtur(){const G=P.atur;
  const klik=(sel,fn)=>document.querySelectorAll(sel).forEach(b=>b.onclick=()=>fn(b));
  const id=$;const tekan=(i,fn)=>{const b=id(i);if(b)b.onclick=fn};
  tekan("atur-muat",()=>muatAtur());
  tekan("ke-kas",()=>A.pindahTab("kas"));tekan("ke-nota",()=>A.pindahTab("nota"));
  klik("[data-seksi]",b=>{G.sec=b.dataset.seksi;G.yakin=null;A.render()});
  klik("[data-item]",b=>simpan("pos_item_save",{id:Number(b.dataset.item),active:b.dataset.aktif==="1"}));
  klik("[data-var]",b=>simpan("pos_variant_save",{id:Number(b.dataset.var),active:b.dataset.aktif==="1"}));
  klik("[data-metode]",b=>simpan("pos_method_save",{id:Number(b.dataset.metode),active:b.dataset.aktif==="1"}));
  klik("[data-diskon]",b=>simpan("pos_discount_save",{id:Number(b.dataset.diskon),active:b.dataset.aktif==="1"}));
  klik("[data-harga]",b=>{const v=nilai("hrg-"+b.dataset.harga);if(v===""||digit(v)===""){G.galat="Harga harus berupa angka.";A.render();return}
    simpan("pos_variant_save",{id:Number(b.dataset.harga),price:Number(digit(v))},"Harga tersimpan.")});
  klik("[data-tambah-var]",b=>{const n=nilai("vn-"+b.dataset.tambahVar),h=digit(nilai("vh-"+b.dataset.tambahVar));
    if(!n||h===""){G.galat="Isi nama ukuran dan harganya.";A.render();return}
    simpan("pos_variant_save",{item_id:Number(b.dataset.tambahVar),name:n,price:Number(h)},"Ukuran ditambah.")});
  tekan("im-tambah",()=>{const n=nilai("im-nama");if(!n){G.galat="Isi nama menu.";A.render();return}
    simpan("pos_item_save",{name:n,category:nilai("im-kat")},"Menu ditambah.")});
  tekan("mt-tambah",()=>{const n=nilai("mt-nama");if(!n){G.galat="Isi nama metode.";A.render();return}
    simpan("pos_method_save",{name:n,kind:nilai("mt-jenis")},"Metode ditambah.")});
  tekan("dk-tambah",()=>{const n=nilai("dk-nama"),v=digit(nilai("dk-nilai"));if(!n||v===""){G.galat="Isi nama dan nilai diskon.";A.render();return}
    if(nilai("dk-jenis")==="persen"&&Number(v)>100){G.galat="Diskon persen maksimal 100.";A.render();return}
    simpan("pos_discount_save",{name:n,kind:nilai("dk-jenis"),value:Number(v)},"Diskon ditambah.")});
  klik("[data-cabut]",b=>{if(G.yakin!==b.dataset.cabut){G.yakin=b.dataset.cabut;A.render();return}G.yakin=null;b.disabled=true;putusDev(b.dataset.cabut,false)});
  klik("[data-dev-atur]",b=>{b.disabled=true;putusDev(b.dataset.devAtur,true)})}

/* ---------- Penghubung ke kasir.js ---------- */
const tahanHp=()=>S.me&&S.me.role==="pemilik"&&S.me.device!=="approved"&&["jual","nota","kas"].includes(S.tab);
function view(tab){
  if(!S.me||S.me.role!=="pemilik")return null;
  if(tab==="laporan")return vLaporan();
  if(tab==="setujui"||tab==="atur"){if(!mfaOk())return vMfa();return tab==="setujui"?vSetuju():vAtur()}
  if(tahanHp())return `<section class="card"><h2>HP ini belum disetujui</h2>
    <p class="muted">Setujui HP ini dulu di tab Setujui (perlu verifikasi 2 langkah), lalu tekan Cek lagi.</p>
    <button type="button" class="btn" id="cek-hp">Cek lagi</button></section>`;
  return null}
function bind(tab){
  if(!S.me||S.me.role!=="pemilik")return false;
  if(tab==="laporan"){bindLaporan();return true}
  if(tab==="setujui"||tab==="atur"){if(!mfaOk())bindMfa();else if(tab==="setujui")bindSetuju();else bindAtur();return true}
  if(tahanHp()){$("cek-hp").onclick=async()=>{try{await A.muatMe()}catch(e){A.toast(A.errMsg(e))}A.render()};return true}
  return false}
function masuk(tab){if(!OWNER_TABS.includes(tab))return;
  if(tab==="laporan"){if(!P.lap.memuat)muatLaporan();return}
  if(!mfaOk()){muatMfa();return}
  if(tab==="setujui")muatSetuju();else if(!P.atur.cat)muatAtur()}
// Angka badge Setujui: dimuat diam-diam setelah masuk dan tiap menit.
async function segarBadge(){if(!mfaOk()||!A.daring()||P.set.memuat)return;
  try{const [v,d]=await Promise.all([A.rpc("pos_void_pending"),A.rpc("pos_devices_list")]);
    const dev=d.filter(x=>x.status==="pending"),b=v.length+dev.length;
    P.set.void=v;P.set.dev=dev;if(b!==P.badge){P.badge=b;A.renderTab()}if(S.tab==="setujui")v.forEach(bukaFoto)}catch(e){}}
function sesudahMe(){if(S.me&&S.me.role==="pemilik"&&mfaOk())segarBadge()}
setInterval(()=>{if(S.me&&S.me.role==="pemilik"&&S.tab!=="setujui")segarBadge()},60*1000);
function tabs(){return [["jual","Jual"],["laporan","Laporan"],["setujui","Setujui",P.badge>0?String(P.badge):"" ],["atur","Atur",null,["nota","kas"]]]}
window.KasirPemilik={tabs,view,bind,masuk,sesudahMe,reset(){P=P0()}};
})();
