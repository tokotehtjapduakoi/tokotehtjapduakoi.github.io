/* Admin Kolam Koi: kasir mendaftarkan nota & memakai voucher; pemilik reset PIN & atur staf. */
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
let sb=null,user=null,sum=null,tab="nota",authMode="masuk",tiers=[[100000,5],[80000,4],[60000,3],[45000,2],[20000,1]],busy=false;
const pullsFor=t=>{for(const[m,n]of tiers)if(t>=m)return n;return 0};
async function rpc(fn,a){const {data,error}=await sb.rpc(fn,a||{});if(error)throw error;return data}
async function q(p){const {data,error}=await p;if(error)throw error;return data}
const owner=()=>sum&&sum.role==="pemilik";

function nav(){const n=$("tabs");if(!sum){n.hidden=true;return}n.hidden=false;
  const T=[["nota","Nota"],["voucher","Voucher"],["member","Member"],...(owner()?[["staf","Staf"]]:[])];n.style.setProperty("--n",T.length);
  n.innerHTML=T.map(([k,l])=>`<button type="button" data-k="${k}" ${k===tab?'aria-current="page"':""}>${l}</button>`).join("");
  n.querySelectorAll("button").forEach(b=>b.onclick=()=>{tab=b.dataset.k;render()})}
function head(){return `<div class="head"><h1>Admin Kolam Koi</h1><button type="button" class="btn sm ghost" id="out">Keluar</button></div>
  <p class="small muted">${esc(user.email)} · ${sum.role}</p>
  <div class="stats"><div class="stat"><b>${sum.receipts_today}</b><span>nota hari ini</span></div><div class="stat"><b>${sum.claimed_today}</b><span>diklaim hari ini</span></div><div class="stat"><b>${sum.members}</b><span>member (+${sum.members_today})</span></div></div>`}

/* ---------- Nota ---------- */
let recent=null;
async function vNota(){recent=recent||await q(sb.from("kk_receipts").select("nota,total,created_at,claimed_at").order("created_at",{ascending:false}).limit(60));
  return head()+`<section class="card"><h2>Daftarkan nota</h2><p class="small muted">Setelah pelanggan bayar di ESB, ketik nomor nota dan total persis seperti di struk. Pelanggan memasukkan nomor & total yang sama di HP-nya.</p>
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
  rt.oninput=()=>{const t=num(rt.value);rt.value=t?t.toLocaleString("id-ID"):"";ri.textContent=t?(pullsFor(t)?`Pelanggan akan dapat ${pullsFor(t)} tarikan`:`Di bawah ${rp(tiers[tiers.length-1][0])}: tidak dapat tarikan`):" "};
  $("rf").onsubmit=async e=>{e.preventDefault();if(busy)return;const n=rn.value.trim().toUpperCase(),t=num(rt.value);if(!n){rn.focus();return toast("Isi nomor nota.")}if(!t){rt.focus();return toast("Isi total belanja.")}
    busy=true;$("rb").disabled=true;try{await rpc("kk_add_receipt",{p_nota:n,p_total:t});toast(`Terdaftar: ${n} · ${rp(t)}`);recent=null;await refresh()}catch(err){toast(errMsg(err))}finally{busy=false;render()}};
  $("rr").onclick=async()=>{recent=null;await refresh();render()};
  document.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{if(!b.dataset.ok){b.dataset.ok=1;b.textContent="Yakin?";return}try{await rpc("kk_delete_receipt",{p_nota:b.dataset.del});toast("Nota dihapus.");recent=null;await refresh();render()}catch(err){toast(errMsg(err))}});
  $("csvf").onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=async()=>{const p=parseCSV(r.result);if(p.err){$("ci").textContent=p.err;return}
    try{const k=await rpc("kk_add_receipts",{p_rows:p.rows});toast(`${k} nota baru terdaftar dari ${p.rows.length} baris.`);recent=null;await refresh();render()}catch(err){$("ci").textContent=errMsg(err)}};r.readAsText(f)}}

/* ---------- Voucher ---------- */
let vc=null,openV=null;
async function vVoucher(){openV=openV||await q(sb.from("kk_exchanges").select("code,item,created_at,kk_members(nickname,phone)").eq("kind","hadiah").is("used_at",null).order("created_at",{ascending:false}).limit(50));
  return head()+`<section class="card"><h2>Cek kode hadiah</h2><form id="vf" style="display:grid;gap:12px"><label for="vcode">Kode dari HP pelanggan<input id="vcode" class="txt" autocomplete="off" autocapitalize="characters" placeholder="TK-XXXXX" value="${esc(vc&&vc.code||"")}"></label><button type="submit" class="btn">Cek</button></form>
  ${vc===false?`<p class="err small">Kode tidak ditemukan. Periksa lagi hurufnya.</p>`:vc?`<div class="voucher"><b>${esc(vc.item)}</b><code>${esc(vc.code)}</code><span class="small muted">${esc(vc.nickname)} · ${hp(vc.phone)}</span><span class="small muted">${jam(vc.created_at)}</span></div>
   ${vc.used_at?`<p class="pill bad" style="justify-self:start">Sudah dipakai ${jam(vc.used_at)}</p>`:`<button type="button" class="btn gold" id="use">Berikan hadiah & tandai dipakai</button>`}`:""}</section>
  <section class="card"><h2>Hadiah belum diambil (${openV.length})</h2><div class="list">${openV.length?openV.map(v=>`<div class="row"><div><b>${esc(v.item)}</b><div class="small muted">${esc(v.kk_members&&v.kk_members.nickname)} · ${hp(v.kk_members&&v.kk_members.phone)} · ${jam(v.created_at)}</div></div><code class="mono small">${esc(v.code)}</code></div>`).join(""):`<p class="small muted">Tidak ada.</p>`}</div></section>`}
function bindVoucher(){$("vf").onsubmit=async e=>{e.preventDefault();const c=$("vcode").value.trim().toUpperCase();if(!c)return;try{vc=(await rpc("kk_check_voucher",{p_code:c}))||false}catch(err){toast(errMsg(err))}render()};
  const u=$("use");if(u)u.onclick=async()=>{if(busy)return;busy=true;u.disabled=true;try{await rpc("kk_use_voucher",{p_code:vc.code});toast("Hadiah diberikan. Voucher ditandai dipakai.");vc=await rpc("kk_check_voucher",{p_code:vc.code});openV=null;await refresh()}catch(err){toast(errMsg(err))}finally{busy=false;render()}}}

/* ---------- Member ---------- */
let mem=null;
function normPhone(v){let d=String(v||"").replace(/\D/g,"");if(d.startsWith("0"))d="62"+d.slice(1);else if(d.startsWith("8"))d="62"+d;return /^62\d{8,13}$/.test(d)?d:null}
function vMember(){return head()+`<section class="card"><h2>Cari member</h2><form id="mf" style="display:grid;gap:12px"><label for="mp">Nomor HP<input id="mp" class="txt" inputmode="tel" placeholder="0812..." value="${esc(mem&&hp(mem.phone)||"")}"></label><button type="submit" class="btn">Cari</button></form>
  ${mem===false?`<p class="err small">Nomor itu belum terdaftar sebagai member.</p>`:mem?`<div class="list"><div class="row"><span class="muted small">Nama</span><b>${esc(mem.nickname)}</b></div><div class="row"><span class="muted small">Transaksi</span><b>${mem.trx} · ${rp(mem.spent)}</b></div><div class="row"><span class="muted small">Saldo poin</span><b>${mem.bank}</b></div><div class="row"><span class="muted small">Daftar</span><b>${jam(mem.created_at)}</b></div></div>
   ${owner()?`<form id="pf" style="display:grid;gap:10px;margin-top:6px"><label for="np">PIN baru (6 angka) · beri tahu pelanggan lewat WA<input id="np" class="txt" inputmode="numeric" maxlength="6" placeholder="••••••"></label><button type="submit" class="btn ghost">Reset PIN</button></form>`:`<p class="small muted">Reset PIN hanya bisa dilakukan pemilik.</p>`}`:""}</section>`}
function bindMember(){$("mf").onsubmit=async e=>{e.preventDefault();const p=normPhone($("mp").value);if(!p)return toast("Nomor HP belum benar.");try{const r=await q(sb.from("kk_members").select("*").eq("phone",p).maybeSingle());mem=r||false}catch(err){toast(errMsg(err))}render()};
  const pf=$("pf");if(pf)pf.onsubmit=async e=>{e.preventDefault();const pin=$("np").value.trim();if(!/^\d{6}$/.test(pin))return toast("PIN harus 6 angka.");try{await rpc("kk_reset_pin",{p_phone:mem.phone,p_pin:pin});toast("PIN direset. Kirim PIN baru ke pelanggan lewat WA.");$("np").value=""}catch(err){toast(errMsg(err))}}}

/* ---------- Staf (pemilik) ---------- */
let staff=null;
async function vStaf(){staff=staff||await q(sb.from("kk_staff").select("user_id,role,name"));
  return head()+`<section class="card"><h2>Tambah kasir</h2><p class="small muted">Minta kasir membuka halaman ini, pilih <b>Daftar akun staf</b> dengan emailnya sendiri. Setelah itu ketik emailnya di sini.</p>
  <form id="sf" style="display:grid;gap:12px"><label for="se">Email kasir<input id="se" class="txt" style="text-transform:none" type="email" autocomplete="off"></label><label for="sn">Nama<input id="sn" class="txt" style="text-transform:none" autocomplete="off"></label>
  <label for="sr">Peran<select id="sr"><option value="kasir">Kasir (daftar nota, voucher)</option><option value="pemilik">Pemilik (semua, termasuk reset PIN)</option></select></label><button type="submit" class="btn">Simpan</button></form></section>
  <section class="card"><h2>Staf (${staff.length})</h2><div class="list">${staff.map(s=>`<div class="row"><div><b>${esc(s.name||"(tanpa nama)")}</b><div class="small muted">${s.role}${s.user_id===user.id?" · kamu":""}</div></div></div>`).join("")}</div>
  <form id="rmf" style="display:grid;gap:10px;margin-top:6px"><label for="re">Hapus akses staf (email)<input id="re" class="txt" style="text-transform:none" type="email" autocomplete="off"></label><button type="submit" class="btn ghost">Hapus akses</button></form></section>`}
function bindStaf(){$("sf").onsubmit=async e=>{e.preventDefault();try{await rpc("kk_set_staff",{p_email:$("se").value,p_role:$("sr").value,p_name:$("sn").value});toast("Staf disimpan.");staff=null;render()}catch(err){toast(errMsg(err))}};
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
  render()}
async function logout(){await sb.auth.signOut().catch(()=>{});user=null;sum=null;recent=openV=staff=null;vc=mem=null;render()}
async function render(){nav();if(!sb){$("app").innerHTML=`<section class="card"><h2>Belum disambungkan</h2><p class="muted">Isi <code>kolam/config.js</code> dengan Project URL dan kunci publishable Supabase.</p></section>`;return}
  if(!user||!sum){$("app").innerHTML=vAuth();bindAuth();return}
  try{const V={nota:[vNota,bindNota],voucher:[vVoucher,bindVoucher],member:[vMember,bindMember],staf:[vStaf,bindStaf]}[tab]||[vNota,bindNota];
    $("app").innerHTML=await V[0]();V[1]();$("out").onclick=logout}catch(e){toast(errMsg(e))}}
async function boot(){if(!CFG.supabaseUrl||!CFG.supabaseKey||!window.supabase){render();return}
  sb=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true,storageKey:"kolamkoi-admin-auth"}});
  try{const t=await q(sb.from("kk_tiers").select("*").order("min_total",{ascending:false}));if(t.length)tiers=t.map(x=>[x.min_total,x.pulls])}catch(e){}
  await start()}
boot();
})();
