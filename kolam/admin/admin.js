/* Admin Kolam Koi: kasir mendaftarkan nota (selama masa transisi ESB) & memakai voucher; pemilik reset PIN & atur staf. */
(function(){
"use strict";
const CFG=window.KOLAM_CONFIG||{};
const $=id=>document.getElementById(id);
const rp=n=>"Rp"+Math.round(n).toLocaleString("id-ID");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num=v=>Number(String(v).replace(/\D/g,""))||0;
const hp=p=>p?"0"+String(p).slice(2):"";
const jam=t=>new Date(t).toLocaleString("id-ID",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
function toast(m){const t=$("toast");t.textContent=m;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(()=>t.hidden=true,3200)}
const errMsg=e=>{const m=(e&&e.message)||String(e);if(/Failed to fetch|NetworkError/i.test(m))return "Koneksi internet bermasalah.";return m};
let sb=null,user=null,sum=null,tab="voucher",authMode="masuk",tiers=[[100000,5],[80000,4],[60000,3],[45000,2],[20000,1]],busy=false;
const pullsFor=t=>{for(const[m,n]of tiers)if(t>=m)return n;return 0};
async function rpc(fn,a){const {data,error}=await sb.rpc(fn,a||{});if(error)throw error;return data}
async function q(p){const {data,error}=await p;if(error)throw error;return data}
const owner=()=>sum&&sum.role==="pemilik";
const mfaOk=()=>!!(sum&&sum.mfa);
// Tab Nota (daftar/hapus nota ESB): untuk semua staf selama "Nota manual oleh kasir" menyala (masa transisi ESB),
// sesudahnya hanya pemilik dengan verifikasi 2 langkah (server menolak yang lain).
const ownerMfa=()=>owner()&&mfaOk();
const tabs=()=>[...(ownerMfa()||(sum&&sum.nota_manual)?[["nota","Nota"]]:[]),["voucher","Voucher"],...(owner()?[["posting","Posting"]]:[]),["member","Member"],...(owner()?[["staf","Staf"]]:[])];

function nav(){const n=$("tabs");if(!sum){n.hidden=true;return}n.hidden=false;
  const T=tabs();if(!T.some(t=>t[0]===tab))tab=T[0][0];n.style.setProperty("--n",T.length);
  n.innerHTML=T.map(([k,l])=>`<button type="button" data-k="${k}" ${k===tab?'aria-current="page"':""}>${l}</button>`).join("");
  n.querySelectorAll("button").forEach(b=>b.onclick=()=>{tab=b.dataset.k;render()})}
function head(){return `<div class="head"><h1>Admin Kolam Koi</h1><button type="button" class="btn sm ghost" id="out">Keluar</button></div>
  <p class="small muted">${esc(user.email)} · ${sum.role}</p>
  <div class="stats"><div class="stat"><b>${sum.receipts_today}</b><span>nota hari ini</span></div><div class="stat"><b>${sum.claimed_today}</b><span>diklaim hari ini</span></div><div class="stat"><b>${sum.members}</b><span>member (+${sum.members_today})</span></div></div>${sum.ajak_today!=null?`<p class="small muted">Hari ini: ${sum.ajak_today} teman baru dari kode ajak · ${sum.posts_today} bonus posting</p>`:""}${owner()&&!mfaOk()?vMfa():""}`}

/* ---------- Verifikasi 2 langkah (pemilik) ---------- */
// Panggilan ke Supabase ada di ../mfa.js (dipakai bersama dengan Kasir); di sini hanya tampilan.
const mf0=()=>({tahap:null,faktor:null,enroll:null,kode:"",pesan:"",sibuk:false});
let mf=mf0();
async function muatMfa(){if(mf.tahap)return;mf.tahap="memuat";
  try{mf.faktor=await KoiMfa.faktor(sb);mf.tahap=mf.faktor?"kode":"belum"}catch(e){mf.tahap="galat";mf.pesan=errMsg(e)}
  render()}
async function mulaiDaftar(){if(mf.sibuk)return;mf.sibuk=true;mf.pesan="";render();
  try{mf.enroll=await KoiMfa.daftar(sb,"Admin Kolam");mf.tahap="daftar"}catch(e){mf.pesan=errMsg(e)}
  mf.sibuk=false;render()}
async function kirimKode(){if(mf.sibuk||mf.kode.length!==6)return;mf.sibuk=true;mf.pesan="";render();
  try{await KoiMfa.buktikan(sb,{daftar:mf.tahap==="daftar"?mf.enroll:null,faktorId:mf.faktor,kode:mf.kode});
    await refresh();if(!mfaOk())throw new Error("Verifikasi belum diterima server. Coba lagi.");
    mf=mf0();toast("Verifikasi 2 langkah berhasil.")}
  catch(e){mf.pesan=KoiMfa.kodeSalah(e)?"Kode salah atau sudah kedaluwarsa. Coba kode yang baru.":errMsg(e);mf.kode=""}
  mf.sibuk=false;render()}
function vMfa(){const pesan=`<p class="err small" role="alert">${esc(mf.pesan)}</p>`;
  const kode=`<label for="mfa-kode">Kode 6 angka dari aplikasi autentikator<input id="mfa-kode" class="txt" inputmode="numeric" autocomplete="one-time-code" maxlength="6" value="${esc(mf.kode)}"></label>${pesan}
    <button type="button" class="btn" id="mfa-kirim"${mf.kode.length===6&&!mf.sibuk?"":" disabled"}>Verifikasi</button>`;
  const kepala=`<h2>Verifikasi 2 langkah</h2>`;
  if(mf.tahap==="daftar"&&mf.enroll)return `<section class="card">${kepala}<p class="small muted">Pindai gambar ini dengan aplikasi autentikator (Google Authenticator, Authy, dan sejenisnya), lalu ketik kode 6 angkanya.</p>
    <div style="text-align:center"><img src="${esc(mf.enroll.qr)}" alt="QR verifikasi 2 langkah" width="200" height="200"></div>
    <p class="small muted">Tidak bisa memindai? Ketik kode rahasia ini di aplikasi: <span class="mono" id="mfa-rahasia">${esc(mf.enroll.secret)}</span></p>${kode}</section>`;
  if(mf.tahap==="kode")return `<section class="card">${kepala}<p class="small muted">Menu pemilik (Nota, reset PIN, Staf) butuh kode dari aplikasi autentikator.</p>${kode}</section>`;
  if(mf.tahap==="belum")return `<section class="card">${kepala}<p class="small muted">Menu pemilik (Nota, reset PIN, Staf) wajib memakai verifikasi 2 langkah. Pasang sekali saja.</p>${pesan}
    <button type="button" class="btn" id="mfa-daftar"${mf.sibuk?" disabled":""}>Pasang verifikasi 2 langkah</button></section>`;
  return `<section class="card">${kepala}<p class="small muted">${mf.tahap==="memuat"?"Memeriksa...":"Belum bisa memeriksa verifikasi."}</p>${mf.tahap==="galat"?pesan+`<button type="button" class="btn" id="mfa-ulang">Coba lagi</button>`:""}</section>`}
function bindMfa(){const k=$("mfa-kode");
  if(k){k.oninput=()=>{mf.kode=k.value.replace(/\D/g,"").slice(0,6);k.value=mf.kode;$("mfa-kirim").disabled=mf.kode.length!==6||mf.sibuk};k.focus()}
  const b=$("mfa-kirim");if(b)b.onclick=kirimKode;
  const d=$("mfa-daftar");if(d)d.onclick=mulaiDaftar;
  const u=$("mfa-ulang");if(u)u.onclick=()=>{mf.tahap=null;mf.pesan="";muatMfa()}}

/* ---------- Nota ---------- */
let recent=null,legacyOn=null;
async function vNota(){if(legacyOn===null)legacyOn=((await q(sb.from("kk_settings").select("legacy_nota_claim").eq("id",1).maybeSingle()))||{}).legacy_nota_claim===true;
  recent=recent||await q(sb.from("kk_receipts").select("nota,total,created_at,claimed_at").order("created_at",{ascending:false}).limit(60));
  // sakelar hanya untuk pemilik dengan 2 langkah (fungsinya di server juga begitu)
  return head()+(ownerMfa()?`<section class="card"><h2>Masa transisi ESB</h2>
  <p class="small muted">Klaim nomor nota lama: bila menyala, pelanggan masih bisa memasukkan nomor nota ESB + total di Kolam Koi.</p>
  <label class="row" for="lg" style="justify-content:flex-start;gap:10px"><input id="lg" type="checkbox"${legacyOn?" checked":""}><span>Klaim nomor nota lama (ESB)</span></label>
  <p class="small muted">Nota manual oleh kasir: bila menyala, kasir boleh mendaftarkan dan menghapus nota ESB di tab ini. Bila mati, hanya pemilik.</p>
  <label class="row" for="nm" style="justify-content:flex-start;gap:10px"><input id="nm" type="checkbox"${sum.nota_manual?" checked":""}><span>Nota manual oleh kasir</span></label>
  <p class="small muted">Saat ESB sudah berhenti dipakai, matikan keduanya.</p></section>`:"")+`
  <section class="card"><h2>Daftarkan nota</h2><p class="small muted">Setelah pelanggan bayar di ESB, ketik nomor nota dan total persis seperti di struk. Pelanggan memasukkan nomor & total yang sama di HP-nya.</p>
  <form id="rf" style="display:grid;gap:12px"><label for="rn">Nomor nota<input id="rn" class="txt" autocomplete="off" autocapitalize="characters" placeholder="POS-1123-0310"></label>
  <label for="rt">Total belanja (Rp)<input id="rt" inputmode="numeric" autocomplete="off" placeholder="0"></label>
  <p class="small muted" id="ri">&nbsp;</p><button type="submit" class="btn" id="rb">Daftarkan</button></form></section>
  <section class="card"><div class="row"><h2>Nota terbaru</h2><button type="button" class="btn sm ghost" id="rr">Muat ulang</button></div>
  <div class="list">${recent.length?recent.map(r=>`<div class="row"><div><b class="mono" style="font-size:13.5px">${esc(r.nota)}</b><div class="small muted">${rp(r.total)} · ${pullsFor(r.total)} tarikan · ${jam(r.created_at)}</div></div>${r.claimed_at?`<span class="pill ok">diklaim</span>`:`<span class="row" style="gap:6px"><span class="pill wait">belum</span><button type="button" class="btn sm ghost" data-del="${esc(r.nota)}" aria-label="Hapus nota ${esc(r.nota)}">Hapus</button></span>`}</div>`).join(""):`<p class="small muted">Belum ada nota.</p>`}</div></section>
  <section class="card"><h2>Daftarkan banyak sekaligus</h2><p class="small muted">Opsional: export laporan per transaksi dari backoffice ESB (CSV), lalu upload. Butuh kolom nomor nota dan total. Nota yang sudah terdaftar dilewati.</p>
  <label for="csvf">Upload file CSV<input id="csvf" type="file" accept=".csv,text/csv" style="font:500 14px var(--f-body);text-align:left"></label><p class="small muted" id="ci"></p></section>`}
function parseCSV(txt){const lines=txt.trim().split(/\r?\n/).filter(Boolean);if(lines.length<2)return {err:"File kosong."};const sep=lines[0].includes(";")?";":",";
  const h=lines[0].split(sep).map(x=>x.trim().replace(/^"|"$/g,"").toLowerCase());const iN=h.findIndex(x=>/nota|receipt|bill|invoice|no\.? ?trans|kode/.test(x)),iT=h.findIndex(x=>/grand|total|jumlah|amount/.test(x));
  if(iN<0||iT<0)return {err:"Kolom nomor nota atau total tidak ditemukan. Kolom yang terbaca: "+h.join(", ")};
  return {rows:lines.slice(1).map(l=>{const c=l.split(sep).map(x=>x.trim().replace(/^"|"$/g,""));return {nota:(c[iN]||"").toUpperCase(),total:num(String(c[iT]||"").replace(/[.,]00$/,""))}}).filter(r=>r.nota&&r.total>0)}}
function bindNota(){const rn=$("rn"),rt=$("rt"),ri=$("ri");rn.focus();
  const lg=$("lg");if(lg)lg.onchange=async e=>{const on=e.target.checked;e.target.disabled=true;
    try{await rpc("kk_set_legacy_claim",{p_on:on});legacyOn=on;toast(on?"Klaim nomor nota lama dinyalakan.":"Klaim nomor nota lama dimatikan.")}
    catch(err){e.target.checked=!on;toast(errMsg(err))}finally{e.target.disabled=false}};
  const nm=$("nm");if(nm)nm.onchange=async e=>{const on=e.target.checked;e.target.disabled=true;
    try{await rpc("kk_set_kasir_nota_manual",{p_on:on});await refresh();toast(on?"Nota manual oleh kasir dinyalakan.":"Nota manual oleh kasir dimatikan.")}
    catch(err){e.target.checked=!on;toast(errMsg(err))}finally{e.target.disabled=false}};
  rt.oninput=()=>{const t=num(rt.value);rt.value=t?t.toLocaleString("id-ID"):"";ri.textContent=t?(pullsFor(t)?`Pelanggan akan dapat ${pullsFor(t)} tarikan`:`Di bawah ${rp(tiers[tiers.length-1][0])}: tidak dapat tarikan`):" "};
  $("rf").onsubmit=async e=>{e.preventDefault();if(busy)return;const n=rn.value.trim().toUpperCase(),t=num(rt.value);if(!n){rn.focus();return toast("Isi nomor nota.")}if(!t){rt.focus();return toast("Isi total belanja.")}
    busy=true;$("rb").disabled=true;try{await rpc("kk_add_receipt",{p_nota:n,p_total:t});toast(`Terdaftar: ${n} · ${rp(t)}`);recent=null;await refresh()}catch(err){toast(errMsg(err))}finally{busy=false;render()}};
  $("rr").onclick=async()=>{recent=null;await refresh();render()};
  document.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{if(!b.dataset.ok){b.dataset.ok=1;b.textContent="Yakin?";return}try{await rpc("kk_delete_receipt",{p_nota:b.dataset.del});toast("Nota dihapus.");recent=null;await refresh();render()}catch(err){toast(errMsg(err))}});
  $("csvf").onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=async()=>{const p=parseCSV(r.result);if(p.err){$("ci").textContent=p.err;return}
    try{const k=await rpc("kk_add_receipts",{p_rows:p.rows});toast(`${k} nota baru terdaftar dari ${p.rows.length} baris.`);recent=null;await refresh();render()}catch(err){$("ci").textContent=errMsg(err)}};r.readAsText(f)}}

/* ---------- Voucher ---------- */
let vc=null,openV=null;
async function vVoucher(){openV=openV||await q(sb.from("kk_exchanges").select("code,item,created_at,kk_members(nickname,phone)").in("kind",["hadiah","bonus"]).is("used_at",null).order("created_at",{ascending:false}).limit(50));
  return head()+`<section class="card"><h2>Cek kode hadiah</h2><form id="vf" style="display:grid;gap:12px"><label for="vcode">Kode dari HP pelanggan<input id="vcode" class="txt" autocomplete="off" autocapitalize="characters" placeholder="TK-XXXXX" value="${esc(vc&&vc.code||"")}"></label><button type="submit" class="btn">Cek</button></form>
  ${vc===false?`<p class="err small">Kode tidak ditemukan. Periksa lagi hurufnya.</p>`:vc?`<div class="voucher"><b>${esc(vc.item)}</b><code>${esc(vc.code)}</code><span class="small muted">${esc(vc.nickname)} · ${hp(vc.phone)}</span><span class="small muted">${jam(vc.created_at)}</span></div>
   ${vc.used_at?`<p class="pill bad" style="justify-self:start">Sudah dipakai ${jam(vc.used_at)}${vc.used_nota?` · nota POS ${esc(vc.used_nota)}`:""}${vc.used_by_name?` · oleh ${esc(vc.used_by_name)}`:""}</p>`:`<p class="small">Di <b>Kasir Koi</b>: ketik kode ini di kolom voucher saat bayar. Voucher langsung hangus dan tercatat dengan nomor nota Kasir Koi.</p>
   ${ownerMfa()||sum.nota_manual?`<p class="small muted" style="margin:0">Transaksi di POS ESB (masa transisi):</p><ol class="small" style="margin:0;padding-left:18px;display:grid;gap:4px"><li>Catat minumannya di POS ESB sebagai transaksi <b>Voucher Kolam Koi</b> (diskon 100% / Rp0).</li><li>Ketik nomor nota ESB transaksi itu di bawah.</li><li>Berikan minumannya. Voucher langsung hangus.</li></ol>
   <label for="vn">Nomor nota POS transaksi voucher<input id="vn" class="txt" autocomplete="off" autocapitalize="characters" placeholder="POS-1123-0311"></label>
   <button type="button" class="btn gold" id="use">Pakai voucher</button>`:""}`}`:""}</section>
  ${ownerMfa()?await vLaporan():""}
  <section class="card"><h2>Hadiah belum diambil (${openV.length})</h2><div class="list">${openV.length?openV.map(v=>`<div class="row"><div><b>${esc(v.item)}</b><div class="small muted">${esc(v.kk_members&&v.kk_members.nickname)} · ${hp(v.kk_members&&v.kk_members.phone)} · ${jam(v.created_at)}</div></div><code class="mono small">${esc(v.code)}</code></div>`).join(""):`<p class="small muted">Tidak ada.</p>`}</div></section>`}
function bindVoucher(){$("vf").onsubmit=async e=>{e.preventDefault();const c=$("vcode").value.trim().toUpperCase();if(!c)return;try{vc=(await rpc("kk_check_voucher",{p_code:c}))||false}catch(err){toast(errMsg(err))}render()};
  const lh=$("lh");if(lh)lh.onchange=()=>{lapDay=lh.value;lap=null;render()};
  const u=$("use");if(u)u.onclick=async()=>{if(busy)return;const nota=$("vn").value.trim().toUpperCase();if(nota.length<3){$("vn").focus();return toast("Isi nomor nota POS transaksi voucher ini.")}busy=true;u.disabled=true;try{await rpc("kk_use_voucher",{p_code:vc.code,p_nota:nota});toast(`Voucher dipakai · nota POS ${nota}.`);lap=null;vc=await rpc("kk_check_voucher",{p_code:vc.code});openV=null;await refresh()}catch(err){toast(errMsg(err))}finally{busy=false;render()}}}

/* ---------- Laporan voucher (pemilik) ---------- */
let lap=null,lapDay=new Date(Date.now()+8*36e5).toISOString().slice(0,10);
async function vLaporan(){try{lap=lap||await rpc("kk_voucher_report",{p_day:lapDay})}catch(e){return `<section class="card"><h2>Laporan voucher</h2><p class="small muted">Jalankan SQL terbaru di Supabase untuk membuka laporan ini.</p></section>`}
  const L=lap.dipakai||[];
  return `<section class="card"><div class="row"><h2>Laporan voucher</h2><input type="date" id="lh" value="${esc(lapDay)}" style="font:600 14px var(--f-body);padding:6px;border-radius:8px;border:1px solid var(--line)"></div>
  <p class="small muted">Minuman gratis yang keluar lewat voucher. Cocokkan dengan stok gelas & teh: gelas terpakai = penjualan POS + voucher di sini.</p>
  <div class="stats"><div class="stat"><b>${L.length}</b><span>voucher dipakai</span></div><div class="stat"><b>${lap.terbit}</b><span>voucher terbit</span></div><div class="stat"><b>${(lap.per_kasir||[]).length}</b><span>kasir</span></div></div>
  ${(lap.per_kasir||[]).map(k=>`<div class="row"><span>${esc(k.kasir)}</span><b>${k.jumlah}</b></div>`).join("")}
  <div class="list">${L.length?L.map(v=>`<div class="row"><div><b>${esc(v.item)}</b><div class="small muted">${jam(v.at)} · ${esc(v.kasir||"-")} · ${esc(v.member)}</div></div><div style="text-align:right"><code class="mono small">${esc(v.nota||"(tanpa nota)")}</code><div class="small muted mono">${esc(v.code)}</div></div></div>`).join(""):`<p class="small muted">Belum ada voucher dipakai di tanggal ini.</p>`}</div></section>`}

/* ---------- Bonus posting (pemilik) ---------- */
let pm=null,pres=null;
function vPosting(){if(!mfaOk())return head()+`<section class="card"><h2>Terbitkan bonus posting</h2><p class="small muted">Menerbitkan bonus posting butuh verifikasi 2 langkah (lihat bagian atas halaman).</p></section>`;
  const N=pm&&pm.nota||[];return head()+`<section class="card"><h2>Terbitkan bonus posting</h2><p class="small muted">Pelanggan mengirim bukti lewat WhatsApp: nomor Kolam Koi, nota belanja, dan link post/story yang men-tag <b>@tokoteh.tjapduakoi</b>. Cek postingannya di Instagram dulu. Syarat: satu nota belanja minimal ${rp(pm&&pm.min||20000)} untuk satu bonus, paling lama ${pm&&pm.hari||3} hari setelah belanja, 1 bonus per hari.</p>
  <form id="pf2" style="display:grid;gap:12px"><label for="pp">Nomor HP member<input id="pp" class="txt" inputmode="tel" placeholder="0812..." value="${esc(pm&&hp(pm.phone)||"")}"></label><button type="submit" class="btn">Cari</button></form>
  ${pm===false?`<p class="err small">Nomor itu belum terdaftar sebagai member.</p>`:pm?`<div class="list"><div class="row"><span class="muted small">Nama</span><b>${esc(pm.nickname)}</b></div><div class="row"><span class="muted small">Bonus posting hari ini</span><b>${pm.today?`<span class="pill bad">sudah dapat</span>`:`<span class="pill ok">belum</span>`}</b></div></div>
   ${pm.today?"":N.length?`<fieldset style="border:none;padding:0;margin:0;display:grid;gap:6px"><legend class="small" style="font-weight:600;margin-bottom:4px">Nota belanja untuk bonus ini</legend>${N.map((n,i)=>`<label style="display:flex;gap:10px;align-items:center;color:var(--ink)"><input type="radio" name="pn" value="${esc(n.nota)}" ${i?"":"checked"} style="width:20px;height:20px"><span><b class="mono">${esc(n.nota)}</b> · ${rp(n.total)} · ${jam(n.at)}</span></label>`).join("")}</fieldset>
   <label for="pl">Link postingan<input id="pl" class="txt" style="text-transform:none" autocomplete="off" placeholder="https://instagram.com/..."></label>
   <p class="small" style="font-weight:600">Pilihan pelanggan:</p><div class="row" style="gap:8px"><button type="button" class="btn gold" style="flex:1" data-pc="esteh">Voucher es teh</button><button type="button" class="btn" style="flex:1" data-pc="tarik">+1 tarikan kartu</button></div>`
   :`<p class="small err">Belum ada nota belanja minimal ${rp(pm.min)} dalam ${pm.hari} hari terakhir yang belum dipakai untuk bonus. Pelanggan perlu belanja dan memasukkan notanya di Kolam Koi dulu.</p>`}`:""}
  ${pres?`<div class="voucher"><b>${esc(pres.nickname)}: ${pres.choice==="esteh"?"voucher es teh gratis":"+1 tarikan kartu"}</b>${pres.code?`<code>${esc(pres.code)}</code><span class="small muted">Voucher sudah masuk ke Hadiahku pelanggan. Balas WA-nya: tunjukkan kode ini ke kasir.</span>`:`<span class="small muted">Tarikan bonus sudah muncul di tab Tarik pelanggan.</span>`}</div>`:""}</section>`}
function bindPosting(){if(!$("pf2"))return;$("pf2").onsubmit=async e=>{e.preventDefault();pres=null;const p=normPhone($("pp").value);if(!p)return toast("Nomor HP belum benar.");
    try{pm=(await rpc("kk_posting_status",{p_phone:p}))||false}catch(err){toast(errMsg(err))}render()};
  document.querySelectorAll("[data-pc]").forEach(b=>b.onclick=async()=>{if(busy)return;const r=document.querySelector("input[name=pn]:checked");if(!r)return toast("Pilih nota belanjanya.");
    const link=($("pl").value||"").trim();if(!/instagram\.com|tiktok\.com|instagr\.am/i.test(link)&&!b.dataset.ok){b.dataset.ok=1;b.textContent="Tanpa link? Ketuk lagi";return}
    busy=true;b.disabled=true;
    try{pres=await rpc("kk_posting_bonus",{p_phone:pm.phone,p_choice:b.dataset.pc,p_nota:r.value,p_link:link});pm=await rpc("kk_posting_status",{p_phone:pm.phone});openV=null;lap=null;toast("Bonus posting diterbitkan.");await refresh()}catch(err){toast(errMsg(err))}finally{busy=false;render()}})}

/* ---------- Member ---------- */
let mem=null;
function normPhone(v){let d=String(v||"").replace(/\D/g,"");if(d.startsWith("0"))d="62"+d.slice(1);else if(d.startsWith("8"))d="62"+d;return /^62\d{8,13}$/.test(d)?d:null}
function vMember(){return head()+`<section class="card"><h2>Cari member</h2><form id="mf" style="display:grid;gap:12px"><label for="mp">Nomor HP<input id="mp" class="txt" inputmode="tel" placeholder="0812..." value="${esc(mem&&hp(mem.phone)||"")}"></label><button type="submit" class="btn">Cari</button></form>
  ${mem===false?`<p class="err small">Nomor itu belum terdaftar sebagai member.</p>`:mem?`<div class="list"><div class="row"><span class="muted small">Nama</span><b>${esc(mem.nickname)}</b></div><div class="row"><span class="muted small">Transaksi</span><b>${mem.trx} · ${rp(mem.spent)}</b></div><div class="row"><span class="muted small">Saldo poin</span><b>${mem.bank}</b></div><div class="row"><span class="muted small">Kode ajak</span><b class="mono">${esc(mem.ref_code||"-")}</b></div><div class="row"><span class="muted small">Diajak oleh</span><b>${mem.referred_by?(mem.ref_done_at?"sudah dapat es teh":"belum belanja min."):"-"}</b></div>${mem.bonus_pulls?`<div class="row"><span class="muted small">Tarikan bonus</span><b>${mem.bonus_pulls}</b></div>`:""}<div class="row"><span class="muted small">Daftar</span><b>${jam(mem.created_at)}</b></div></div>
   ${owner()&&mfaOk()?`<form id="pf" style="display:grid;gap:10px;margin-top:6px"><label for="np">PIN baru (6 angka) · beri tahu pelanggan lewat WA<input id="np" class="txt" inputmode="numeric" maxlength="6" placeholder="••••••"></label><button type="submit" class="btn ghost">Reset PIN</button></form>`:`<p class="small muted">${owner()?"Reset PIN butuh verifikasi 2 langkah (lihat bagian atas halaman).":"Reset PIN hanya bisa dilakukan pemilik."}</p>`}`:""}</section>`}
function bindMember(){$("mf").onsubmit=async e=>{e.preventDefault();const p=normPhone($("mp").value);if(!p)return toast("Nomor HP belum benar.");try{const r=await q(sb.from("kk_members").select("*").eq("phone",p).maybeSingle());mem=r||false}catch(err){toast(errMsg(err))}render()};
  const pf=$("pf");if(pf)pf.onsubmit=async e=>{e.preventDefault();const pin=$("np").value.trim();if(!/^\d{6}$/.test(pin))return toast("PIN harus 6 angka.");try{await rpc("kk_reset_pin",{p_phone:mem.phone,p_pin:pin});toast("PIN direset. Kirim PIN baru ke pelanggan lewat WA.");$("np").value=""}catch(err){toast(errMsg(err))}}}

/* ---------- Staf (pemilik) ---------- */
let staff=null;
async function vStaf(){staff=staff||await q(sb.from("kk_staff").select("user_id,role,name"));
  if(!mfaOk())return head()+`<section class="card"><h2>Staf</h2><p class="small muted">Mengatur staf butuh verifikasi 2 langkah (lihat bagian atas halaman).</p></section>`;
  return head()+`<section class="card"><h2>Tambah kasir</h2><p class="small muted">Minta kasir membuka halaman ini, pilih <b>Daftar akun staf</b> dengan emailnya sendiri. Setelah itu ketik emailnya di sini.</p>
  <form id="sf" style="display:grid;gap:12px"><label for="se">Email kasir<input id="se" class="txt" style="text-transform:none" type="email" autocomplete="off"></label><label for="sn">Nama<input id="sn" class="txt" style="text-transform:none" autocomplete="off"></label>
  <label for="sp">Nomor HP (WhatsApp)<input id="sp" class="txt" inputmode="tel" autocomplete="off" placeholder="0812..."></label>
  <label for="sr">Peran<select id="sr"><option value="kasir">Kasir (daftar nota, voucher)</option><option value="pemilik">Pemilik (semua, termasuk reset PIN)</option></select></label><button type="submit" class="btn">Simpan</button></form></section>
  <section class="card"><h2>Staf (${staff.length})</h2><div class="list">${staff.map(s=>`<div class="row"><div><b>${esc(s.name||"(tanpa nama)")}</b><div class="small muted">${s.role}${s.user_id===user.id?" · kamu":""}</div></div></div>`).join("")}</div>
  <form id="rmf" style="display:grid;gap:10px;margin-top:6px"><label for="re">Hapus akses staf (email)<input id="re" class="txt" style="text-transform:none" type="email" autocomplete="off"></label><button type="submit" class="btn ghost">Hapus akses</button></form></section>`}
function bindStaf(){if(!mfaOk())return;
  $("sf").onsubmit=async e=>{e.preventDefault();const ph=$("sp").value.trim(),p=ph?normPhone(ph):"";if(ph&&!p)return toast("Nomor HP belum benar. Contoh: 0812 3456 7890");
    try{await rpc("kk_set_staff",{p_email:$("se").value,p_role:$("sr").value,p_name:$("sn").value,p_phone:p||null});toast("Staf disimpan.");staff=null;render()}catch(err){toast(errMsg(err))}};
  $("rmf").onsubmit=async e=>{e.preventDefault();try{await rpc("kk_set_staff",{p_email:$("re").value,p_role:null});toast("Akses dihapus.");staff=null;render()}catch(err){toast(errMsg(err))}}}

/* ---------- Masuk ---------- */
function vAuth(){const d=authMode==="daftar";return `<div class="head"><h1>Admin Kolam Koi</h1><a class="small muted" href="../">Halaman member</a></div>
  <section class="card"><div class="seg" role="group" aria-label="Pilih"><button type="button" data-m="masuk" aria-pressed="${!d}">Masuk</button><button type="button" data-m="daftar" aria-pressed="${d}">Daftar akun staf</button></div>
  <form id="af" style="display:grid;gap:12px"><label for="em">Email<input id="em" class="txt" style="text-transform:none" type="email" autocomplete="username" required></label>
  <label for="pw">Kata sandi${d?" (minimal 10 karakter)":""}<input id="pw" class="txt" style="text-transform:none" type="password" autocomplete="${d?"new-password":"current-password"}" required></label>
  <button type="submit" class="btn" id="ab">${d?"Daftar":"Masuk"}</button></form>
  ${d?`<p class="small muted">Setelah daftar, minta pemilik menambahkan emailmu di menu Staf.</p>`:""}</section>`}
function bindAuth(){document.querySelectorAll("[data-m]").forEach(b=>b.onclick=()=>{authMode=b.dataset.m;render()});
  $("af").onsubmit=async e=>{e.preventDefault();const em=$("em").value.trim(),pw=$("pw").value;if(authMode==="daftar"&&pw.length<10)return toast("Kata sandi minimal 10 karakter.");
    if(/@member\.tjapduakoi\.id$/i.test(em))return toast("Pakai email asli.");
    try{let r=authMode==="daftar"?await sb.auth.signUp({email:em,password:pw}):await sb.auth.signInWithPassword({email:em,password:pw});
      if(r.error)throw r.error;if(authMode==="daftar"&&!r.data.session)r=await sb.auth.signInWithPassword({email:em,password:pw});if(r.error)throw r.error;
      await start()}catch(err){toast(/invalid login|credentials/i.test(err.message)?"Email atau kata sandi salah.":errMsg(err))}}}

async function refresh(){sum=await rpc("kk_admin_summary")}
async function start(){const {data}=await sb.auth.getSession();user=data.session&&data.session.user;sum=null;
  if(user){try{await refresh()}catch(e){sum=null;$("app").innerHTML=`<div class="head"><h1>Admin Kolam Koi</h1></div><section class="card"><h2>Belum jadi staf</h2><p class="muted">Akun <b>${esc(user.email)}</b> sudah masuk, tapi belum ditambahkan sebagai kasir. Minta pemilik menambahkan emailmu di menu Staf.</p><button class="btn ghost" id="out2">Keluar</button></section>`;$("out2").onclick=logout;nav();return}}
  if(sum)tab=tabs()[0][0];render()}
async function logout(){await sb.auth.signOut().catch(()=>{});user=null;sum=null;recent=openV=staff=null;vc=mem=null;legacyOn=null;mf=mf0();render()}
async function render(){nav();if(!sb){$("app").innerHTML=`<section class="card"><h2>Belum disambungkan</h2><p class="muted">Isi <code>kolam/config.js</code> dengan Project URL dan kunci publishable Supabase.</p></section>`;return}
  if(!user||!sum){$("app").innerHTML=vAuth();bindAuth();return}
  try{const V={nota:[vNota,bindNota],voucher:[vVoucher,bindVoucher],posting:[vPosting,bindPosting],member:[vMember,bindMember],staf:[vStaf,bindStaf]}[tab]||[vVoucher,bindVoucher];
    const perluMfa=owner()&&!mfaOk();if(perluMfa&&!mf.tahap)muatMfa();
    $("app").innerHTML=await V[0]();V[1]();if(perluMfa)bindMfa();$("out").onclick=logout}catch(e){toast(errMsg(e))}}
async function boot(){if(!CFG.supabaseUrl||!CFG.supabaseKey||!window.supabase){render();return}
  sb=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true,storageKey:"kolamkoi-admin-auth"}});
  try{const t=await q(sb.from("kk_tiers").select("*").order("min_total",{ascending:false}));if(t.length)tiers=t.map(x=>[x.min_total,x.pulls])}catch(e){}
  await start()}
boot();
})();
