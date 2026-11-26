/* Layar pemilik Kasir Tjap Dua Koi: Laporan, Setujui (batal + nota ditahan + perangkat), Atur (menu, metode, diskon, laci kas, perangkat, staf),
   dan verifikasi 2 langkah. Dimuat sesudah kasir.js dan memakai window.KasirApp. Semua RPC lewat sb.rpc, tanpa sb.from().
   Tab pemilik: Jual · Laporan · Setujui · Atur. Kas dan Nota tetap bisa dibuka dari Atur ("Kas shift saya" / "Nota shift ini"). */
(function(){
"use strict";
const A=window.KasirApp,S=A.S,esc=A.esc,rp=A.rp;
const CFG=window.KASIR_CONFIG||{};
const digit=s=>String(s||"").replace(/\D/g,"");
const $=id=>document.getElementById(id);
const OWNER_TABS=["laporan","setujui","atur"];
const P0=()=>({
  lap:{mode:"harian",day:null,data:null,memuat:false,galat:"",rg:{dari:"",sampai:"",data:null,memuat:false,galat:""}},
  set:{void:[],tahan:[],dev:[],memuat:false,galat:"",yakin:null,hasil:[],foto:{}},
  atur:{sec:"menu",cat:null,devs:[],memuat:false,galat:"",yakin:null},
  kas:K0(),
  mfa:{tahap:null,faktor:null,enroll:null,kode:"",pesan:"",sibuk:false},
  badge:0});
let P=P0();
function K0(){return {st:null,memuat:false,galat:"",mode:null,jumlah:"",alasan:"",foto:null,fotoUrl:null,fotoPath:null,yakin:false,sibuk:false,pesan:"",hasil:null}}
const mfaOk=()=>!!(S.me&&S.me.mfa);
const ini=()=>S.tab; // tab yang sedang tampil
const segar=tab=>{if(S.screen==="jual"&&S.tab===tab)A.render()};

/* ---------- Verifikasi 2 langkah (TOTP) ---------- */
async function muatMfa(){const m=P.mfa;if(m.tahap)return;m.tahap="memuat";
  try{m.faktor=await KoiMfa.faktor(S.sb);m.tahap=m.faktor?"kode":"belum"}
  catch(e){m.tahap=null;m.pesan=A.errMsg(e)}
  segar(ini())}
async function mulaiDaftar(){const m=P.mfa;if(m.sibuk)return;m.sibuk=true;m.pesan="";A.render();
  try{m.enroll=await KoiMfa.daftar(S.sb,"Kasir");m.tahap="daftar"}
  catch(e){m.pesan=A.errMsg(e)}
  m.sibuk=false;A.render()}
async function kirimKode(){const m=P.mfa;if(m.sibuk||m.kode.length!==6)return;m.sibuk=true;m.pesan="";A.render();
  try{await KoiMfa.buktikan(S.sb,{daftar:m.tahap==="daftar"?m.enroll:null,faktorId:m.faktor,kode:m.kode});
    await A.muatMe();
    if(!mfaOk())throw new Error("Verifikasi belum diterima server. Coba lagi.");
    P.mfa=P0().mfa;masuk(S.tab);sesudahMe()}
  catch(e){m.pesan=KoiMfa.kodeSalah(e)?"Kode salah atau sudah kedaluwarsa. Coba kode yang baru.":A.errMsg(e);m.kode=""}
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
  if(d.offline&&d.offline.held>0)w.push(`${esc(d.offline.held)} nota ditahan (kode klaim belum aktif). Periksa di tab Setujui.`);
  for(const x of (d.offline&&d.offline.inactive)||[]){const apa=[x.discount?`diskon "${esc(x.discount)}"`:"",x.method?`metode bayar "${esc(x.method)}"`:""].filter(Boolean).join(" dan ");
    w.push(`Nota offline ${esc(x.no)} (${rp(x.total)}) memakai ${apa} yang sudah nonaktif.`)}
  for(const s of d.shifts||[]){const nm=esc(s.cashier||"Kasir");
    if(s.selisih!=null&&s.selisih!==0)w.push(`Selisih kas shift ${nm}: ${esc(tanda(s.selisih))} (hitungan ${rp(s.counted)}, seharusnya ${rp(s.expected)}).`);
    if(s.selisih_terima!=null&&s.selisih_terima!==0)w.push(`Selisih saat terima laci (kasir penerima setelah ${nm}): ${esc(tanda(s.selisih_terima))}.`);
    if(s.start_mismatch)w.push(`Modal awal shift ${nm} tidak sama dengan hitungan penutupan shift sebelumnya.`)}
  for(const x of d.suspicious||[])w.push(`Nota ${esc(x.no)}: ${esc(x.reason)}.`);
  return w}
function vHarian(){const L=P.lap,d=L.data;
  const pilih=`<label for="lap-hari">Tanggal<input id="lap-hari" type="date" value="${esc(L.day||"")}"></label>`;
  const kepala=`<section class="card"><div class="head"><h2>Laporan</h2><button type="button" class="btn sm ghost" id="lap-muat"${L.memuat?" disabled":""}>Muat ulang</button></div>${saklar()}${pilih}
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
  <section class="card" id="lap-shift"><h3>Shift</h3>${daftarBaris(d.shifts,s=>baris(`${esc(s.cashier||"-")} · ${esc(A.waktuHP(s.opened_at))}${s.closed_at?"–"+esc(A.waktuHP(s.closed_at)):" (berjalan)"}${kasShift(s)}`,
      s.counted==null?"belum ditutup":`hitung ${rp(s.counted)} / seharusnya ${rp(s.expected)}`))}</section>
  ${vKasLaporan(d.cash)}
  <section class="card"><h3>Kode klaim kartu</h3>${baris("Diterbitkan",esc(d.codes.issued))}${baris("Sudah diklaim",esc(d.codes.claimed))}${baris("Kedaluwarsa belum diklaim",esc(d.codes.expired_unclaimed))}
    ${d.storage_mb!=null?`<p class="small muted">Foto bukti memakai ${esc(d.storage_mb)} MB.</p>`:""}</section>`}
// Ambil/tambah kas pemilik di baris shift (selama shift = masuk hitungan seharusnya; setelah tutup toko = modal besok).
function kasShift(s){const a=[];
  if(s.ambil)a.push(`ambil kas ${rp(s.ambil)}`);if(s.tambah)a.push(`tambah kas ${rp(s.tambah)}`);
  if(s.ambil_setelah_tutup)a.push(`ambil kas ${rp(s.ambil_setelah_tutup)} setelah tutup`);
  if(s.tambah_setelah_tutup)a.push(`tambah kas ${rp(s.tambah_setelah_tutup)} setelah tutup`);
  return a.length?`<span class="small muted kas-shift"> · ${a.join(" · ")}</span>`:""}
const barisGerak=m=>baris(`${esc(A.waktuHP(m.at))} · ${m.kind==="ambil"?"Ambil":"Tambah"} · ${esc(m.reason)}<span class="small muted"> · ${esc(m.by||"-")}</span>`,
  `${m.kind==="ambil"?"−":"+"}${rp(m.amount)}`);
function vKasLaporan(c){if(!c||!c.count)return "";
  return `<section class="card" id="lap-kas"><h3>Ambil / tambah kas</h3>${baris("Ambil kas","−"+rp(c.ambil_total))}${baris("Tambah kas","+"+rp(c.tambah_total))}
    ${(c.moves||[]).map(barisGerak).join("")}</section>`}
function bindHarian(){const h=$("lap-hari");if(h)h.onchange=()=>{if(h.value)muatLaporan(h.value)};
  const m=$("lap-muat");if(m)m.onclick=()=>muatLaporan()}

/* ---------- Laporan rentang tanggal ---------- */
// Pilihan terakhir (harian/rentang + tanggal) diingat di HP ini saja.
const KUNCI_LAP="kasir.laporan";
function simpanan(){try{const v=JSON.parse(localStorage.getItem(KUNCI_LAP)||"null");if(!v)return;
  if(v.mode==="rentang"||v.mode==="harian")P.lap.mode=v.mode;
  const ok=x=>typeof x==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(x);
  if(ok(v.dari)&&ok(v.sampai)){P.lap.rg.dari=v.dari;P.lap.rg.sampai=v.sampai}}catch(e){}}
function ingat(){const L=P.lap;try{localStorage.setItem(KUNCI_LAP,JSON.stringify({mode:L.mode,dari:L.rg.dari,sampai:L.rg.sampai}))}catch(e){}}
const BULAN=["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const BLN=["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
const tgl=s=>new Date(s+"T00:00:00Z");
const iso=d=>d.toISOString().slice(0,10);
const geser=(s,n)=>{const d=tgl(s);d.setUTCDate(d.getUTCDate()+n);return iso(d)};
const hariWita=iso=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Makassar",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(iso));
const hariIni=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Makassar",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const awalBulan=(s,n=0)=>{const d=tgl(s.slice(0,8)+"01");d.setUTCMonth(d.getUTCMonth()+n);return iso(d)};
const CEPAT=[["7h","7 hari",t=>[geser(t,-6),t]],["ini","Bulan ini",t=>[awalBulan(t),t]],
  ["lalu","Bulan lalu",t=>[awalBulan(t,-1),geser(awalBulan(t),-1)]],["3b","3 bulan",t=>[awalBulan(t,-2),t]]];
const tglPanjang=s=>{const d=tgl(s);return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`};
const tglPendek=s=>{const d=tgl(s);return `${d.getUTCDate()} ${BLN[d.getUTCMonth()]}`};
// "1–14 November 2026", "1 November – 12 Desember 2026", "13 Januari 2026 – 16 Juni 2027"
function teksRentang(a,b){if(a===b)return tglPanjang(a);const x=tgl(a),y=tgl(b);
  if(x.getUTCFullYear()!==y.getUTCFullYear())return `${tglPanjang(a)} – ${tglPanjang(b)}`;
  if(x.getUTCMonth()!==y.getUTCMonth())return `${x.getUTCDate()} ${BULAN[x.getUTCMonth()]} – ${tglPanjang(b)}`;
  return `${x.getUTCDate()}–${tglPanjang(b)}`}
// Rupiah ringkas untuk sumbu grafik: Rp850rb, Rp1,5jt
const rpPendek=n=>n>=1e6?"Rp"+String(Math.round(n/1e5)/10).replace(".",",")+"jt":n>=1000?"Rp"+Math.round(n/1000)+"rb":rp(n);
function atasBulat(m){if(m<=0)return 0;const p=Math.pow(10,Math.floor(Math.log10(m)));
  for(const f of [1,1.5,2,2.5,3,4,5,6,8,10])if(f*p>=m)return f*p;return 10*p}
async function muatRentang(dari,sampai){const R=P.lap.rg;
  if(dari!==undefined){R.dari=dari;R.sampai=sampai}
  if(!R.dari||!R.sampai){const [a,b]=CEPAT[1][2](hariIni());R.dari=a;R.sampai=b}
  ingat();
  if(R.dari>R.sampai){R.galat="Tanggal Sampai tidak boleh sebelum tanggal Dari.";R.data=null;segar("laporan");return}
  R.memuat=true;R.galat="";segar("laporan");
  try{R.data=await A.rpc("pos_report_range",{p_from:R.dari,p_to:R.sampai})}
  catch(e){R.galat=A.errMsg(e);R.data=null}
  R.memuat=false;segar("laporan")}
// Grafik batang omzet (SVG buatan sendiri). Ember per hari / minggu / bulan mengikuti server.
function grafik(d){const se=d.series||[],n=se.length;if(!n)return "";
  const W=340,H=196,atas=24,bawah=150,kiri=4,lebar=(W-kiri*2)/n,maks=atasBulat(Math.max(...se.map(b=>b.omzet)));
  const t=hariIni(),best=d.best_day&&d.best_day.day,isi=(b,x)=>x&&b.label_start<=x&&x<=b.label_end;
  const namaEmber=b=>d.bucket==="day"?tglPanjang(b.label_start):d.bucket==="week"?`${tglPendek(b.label_start)} – ${tglPendek(b.label_end)}`:`${BULAN[tgl(b.label_start).getUTCMonth()]} ${tgl(b.label_start).getUTCFullYear()}`;
  const satuTahun=se[0].label_start.slice(0,4)===se[n-1].label_end.slice(0,4),langkah=Math.ceil(n/6);
  const label=(b,i)=>{const x=tgl(b.label_start),tg=x.getUTCDate();
    if(d.bucket==="day"){const muncul=[1,5,10,15,20,25].includes(tg);
      return muncul?[String(tg),tg===1||i===0?BLN[x.getUTCMonth()]:""]:i===0?[String(tg),BLN[x.getUTCMonth()]]:null}
    if(d.bucket==="week")return i%langkah===0?[tglPendek(b.label_start),""]:null;
    return [BLN[x.getUTCMonth()],(!satuTahun&&(x.getUTCMonth()===0||i===0))?String(x.getUTCFullYear()):""]};
  let batang="",teks="";
  se.forEach((b,i)=>{const h=maks?(b.omzet/maks)*(bawah-atas):0,x=kiri+i*lebar+lebar*0.15,w=Math.max(lebar*0.7,1);
    const emas=isi(b,best)&&b.omzet>0||isi(b,t);
    batang+=`<rect class="bt${emas?" emas":""}" x="${x.toFixed(1)}" y="${(bawah-h).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(h,0).toFixed(1)}" rx="1.5"><title>${esc(namaEmber(b))}: ${esc(rp(b.omzet))}, ${esc(b.notas)} nota</title></rect>`;
    const l=label(b,i);if(l){const cx=(kiri+i*lebar+lebar/2).toFixed(1);
      teks+=`<text x="${cx}" y="164" text-anchor="middle">${esc(l[0])}</text>${l[1]?`<text x="${cx}" y="178" text-anchor="middle">${esc(l[1])}</text>`:""}`}});
  const per={day:"hari",week:"minggu",month:"bulan"}[d.bucket]||"hari";
  const judul=`Grafik omzet per ${per}, ${teksRentang(d.from,d.to)}. Tertinggi ${rpPendek(maks)}.${best?` Hari terbaik ${tglPanjang(best)}: ${rp(d.best_day.omzet)}.`:""}`;
  return `<section class="card"><h3>Omzet per ${per}</h3>
  <svg class="grafik" id="rg-grafik" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="rg-grafik-judul" preserveAspectRatio="xMidYMid meet">
    <title id="rg-grafik-judul">${esc(judul)}</title>
    <line class="garis" x1="${kiri}" x2="${W-kiri}" y1="${atas}" y2="${atas}" stroke-dasharray="3 3"></line>
    <text class="ymax" x="${kiri}" y="${atas-8}">${esc(maks?rpPendek(maks):"Rp0")}</text>
    <line class="garis" x1="${kiri}" x2="${W-kiri}" y1="${bawah}" y2="${bawah}"></line>${batang}${teks}</svg>
  <p class="small muted"><span class="kotak emas"></span> Emas = ${d.bucket==="day"?"hari":d.bucket==="week"?"minggu":"bulan"} terbaik dan hari ini</p></section>`}
function vRentang(){const L=P.lap,R=L.rg,d=R.data;
  const kepala=`<section class="card"><div class="head"><h2>Laporan</h2><button type="button" class="btn sm ghost" id="rg-muat"${R.memuat?" disabled":""}>Muat ulang</button></div>${saklar()}
    <div class="cepat" role="group" aria-label="Pilih cepat">${CEPAT.map(c=>`<button type="button" data-cepat="${c[0]}">${c[1]}</button>`).join("")}</div>
    <div class="aksi2"><label for="rg-dari">Dari<input id="rg-dari" type="date" value="${esc(R.dari)}"></label>
    <label for="rg-sampai">Sampai<input id="rg-sampai" type="date" value="${esc(R.sampai)}"></label></div>
    ${R.galat?`<p class="err" role="alert">${esc(R.galat)}</p>`:""}</section>`;
  if(!d)return kepala+(R.memuat?`<p class="muted tengah">Memuat...</p>`:"");
  const cs=d.cash||{},cat=[];
  cat.push(baris("Nota batal",`${esc(d.voids.count)} nota · ${rp(d.voids.total)}`));
  cat.push(baris("Diskon",`${esc(d.discounts.count)} nota · ${rp(d.discounts.total)}`));
  cat.push(baris("Selisih kas",cs.shifts_with_selisih?`${esc(tanda(cs.total_selisih))} · ${esc(cs.shifts_with_selisih)} dari ${esc(cs.shifts)} shift`:`tidak ada · ${esc(cs.shifts||0)} shift`));
  if(cs.moves_count){cat.push(baris("Ambil kas","−"+rp(cs.ambil_total)));cat.push(baris("Tambah kas","+"+rp(cs.tambah_total)));
    cat.push(`<details class="kas-rinci"><summary>${esc(cs.moves_count)} catatan ambil/tambah kas${cs.moves_count>(cs.moves||[]).length?` (${esc(cs.moves.length)} terbaru)`:""}</summary>
      ${(cs.moves||[]).map(m=>baris(`${esc(tglPendek(hariWita(m.at)))} ${esc(A.waktuHP(m.at))} · ${m.kind==="ambil"?"Ambil":"Tambah"} · ${esc(m.reason)}<span class="small muted"> · ${esc(m.by||"-")}</span>`,
        `${m.kind==="ambil"?"−":"+"}${rp(m.amount)}`)).join("")}</details>`)}
  else cat.push(baris("Ambil / tambah kas","tidak ada"));
  cat.push(baris("Nota offline",`${esc(d.offline.count)} nota${d.offline.mismatch?` · ${esc(d.offline.mismatch)} beda harga`:""}`));
  cat.push(baris("Kode klaim diklaim",`${esc(d.codes.claimed)} dari ${esc(d.codes.issued)}`));
  if(d.pending_voids>0)cat.push(`<p class="warn">${esc(d.pending_voids)} pengajuan batal menunggu keputusanmu di tab Setujui.</p>`);
  const terbaik=d.best_day?`${esc(tglPendek(d.best_day.day))}<span class="small muted"> ${rp(d.best_day.omzet)}</span>`:"-";
  return kepala+`<section class="card"><p class="judul-rentang" id="rg-judul">${esc(teksRentang(d.from,d.to))}</p>
    <div class="angka angka2"><div><span class="small muted">Omzet</span><b id="rg-omzet">${rp(d.omzet)}</b></div>
    <div><span class="small muted">Jumlah nota</span><b id="rg-nota">${esc(d.notas)}</b></div>
    <div><span class="small muted">Rata-rata per nota</span><b id="rg-avg">${rp(d.avg)}</b></div>
    <div><span class="small muted">Rata-rata per hari</span><b id="rg-harian">${rp(d.avg_per_day)}</b></div>
    <div class="lebar"><span class="small muted">Hari terbaik</span><b id="rg-terbaik">${terbaik}</b></div></div>
    <p class="small muted">${esc(d.days_elapsed)} hari${d.days_elapsed<d.days_count?` (dari ${esc(d.days_count)} hari, sisanya belum lewat)`:""}</p></section>
  ${grafik(d)}
  <section class="card"><h3>Per metode bayar</h3>${daftarBaris(d.by_method,m=>baris(`${esc(m.name)} · ${esc(m.count)} nota`,rp(m.total)))}</section>
  <section class="card"><h3>Per kasir</h3>${daftarBaris(d.by_cashier,c=>baris(`${esc(c.name||"-")} · ${esc(c.count)} nota`,rp(c.total)))}</section>
  <section class="card"><h3>Menu terlaris</h3>${daftarBaris(d.top_items,t=>baris(`${esc(t.item)} ${esc(t.variant)} × ${esc(t.qty)}`,rp(t.total)))}</section>
  <section class="card" id="rg-catatan"><h3>Catatan</h3>${cat.join("")}</section>`}
function bindRentang(){const a=$("rg-dari"),b=$("rg-sampai");
  const ubah=()=>{if(a.value&&b.value)muatRentang(a.value,b.value)};
  if(a)a.onchange=ubah;if(b)b.onchange=ubah;
  document.querySelectorAll("[data-cepat]").forEach(x=>x.onclick=()=>{const c=CEPAT.find(c=>c[0]===x.dataset.cepat);const [d1,d2]=c[2](hariIni());muatRentang(d1,d2)});
  const m=$("rg-muat");if(m)m.onclick=()=>muatRentang()}
/* Saklar Harian | Rentang */
const saklar=()=>`<div class="metode" role="group" aria-label="Jenis laporan">${[["harian","Harian"],["rentang","Rentang"]].map(m=>
  `<button type="button" data-mode="${m[0]}" aria-pressed="${P.lap.mode===m[0]}">${m[1]}</button>`).join("")}</div>`;
function muatMode(){const L=P.lap;if(L.mode==="rentang"){if(!L.rg.memuat)muatRentang()}else if(!L.memuat)muatLaporan()}
const vLaporan=()=>P.lap.mode==="rentang"?vRentang():vHarian();
function bindLaporan(){document.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{if(P.lap.mode===b.dataset.mode)return;
    P.lap.mode=b.dataset.mode;ingat();A.render();muatMode()});
  if(P.lap.mode==="rentang")bindRentang();else bindHarian()}

/* ---------- Setujui: pengajuan batal + perangkat menunggu ---------- */
const FOTO_UMUR=4*60*1000; // tautan foto berlaku 300 detik; muat ulang bila lebih tua dari ini
const bukaFoto=async n=>{const f=P.set.foto,e=f[n.nota_id];if(!n.photo_path||(e&&Date.now()-e.at<FOTO_UMUR))return;f[n.nota_id]={at:Date.now(),url:null};let url=false;
  try{const r=await S.sb.storage.from("bukti").createSignedUrl(n.photo_path,300);if(!r.error&&r.data)url=r.data.signedUrl}catch(x){}
  f[n.nota_id]={at:Date.now(),url};segar("setujui")};
async function muatSetuju(){const T=P.set;T.memuat=true;T.galat="";
  try{[T.void,T.tahan,T.dev]=await Promise.all([A.rpc("pos_void_pending"),A.rpc("pos_held_list"),A.rpc("pos_devices_list")]);T.dev=T.dev.filter(d=>d.status==="pending");
    hitungBadge();fotoSemua()}
  catch(e){T.galat=A.errMsg(e)}
  T.memuat=false;segar("setujui");A.renderTab()}
function hitungBadge(){P.badge=P.set.void.length+P.set.tahan.length+P.set.dev.length}
const fotoSemua=()=>{P.set.void.forEach(bukaFoto);P.set.tahan.forEach(n=>bukaFoto({nota_id:n.id,photo_path:n.photo_path}))};
// Nota ditahan: dibuat saat offline di HP yang kemudian dicabut. Lepas tahanan = kode klaim aktif.
function vTahan(n){const T=P.set,k="t"+n.id,f=(T.foto[n.id]||{}).url,yakin=T.yakin&&T.yakin.k===k;
  return `<section class="card kartu-tahan" data-nota="${esc(n.no)}"><div class="head"><h3>Nota ${esc(n.no)}</h3><b>${rp(n.total)}</b></div>
  <p class="small muted">${esc(n.cashier||"Kasir")} · ${esc(n.device_label||"HP dicabut")} · ${esc(A.waktuHP(n.client_at))} · ${esc(n.method)}</p>
  ${(n.lines||[]).map(l=>baris(`${esc(l.qty)}× ${esc(l.item)} ${esc(l.variant)}${l.free?" (gratis)":""}`,rp(l.price*l.qty))).join("")}
  <p class="small muted">Dijual saat offline di HP yang sudah dicabut. Kode klaimnya belum bisa dipakai pelanggan.</p>
  ${f?`<img class="foto-nota" src="${esc(f)}" alt="Foto bukti nota ${esc(n.no)}">`:n.photo_path?`<p class="small muted">${f===false?"Foto tidak bisa dimuat.":"Memuat foto..."}</p>`:""}
  <button type="button" class="btn${yakin?"":" ghost"}" data-lepas="${esc(n.id)}">${yakin?"Yakin lepas tahanan? Ketuk lagi":"Lepas tahanan"}</button></section>`}
async function lepasTahan(id){const T=P.set,n=T.tahan.find(x=>x.id===id);if(!n)return;
  try{await A.rpc("pos_hold_release",{p_nota:id});
    T.hasil.unshift({teks:`Tahanan nota ${n.no} dilepas. Kode klaimnya sudah bisa dipakai.`});
    T.hasil=T.hasil.slice(0,5);T.yakin=null;P.lap.data=null;await muatSetuju()}
  catch(e){T.galat=A.errMsg(e);T.yakin=null;A.render()}}
function vVoid(n){const T=P.set,k="v"+n.id,f=(T.foto[n.nota_id]||{}).url;
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
  ${T.tahan.length?`<h3>Nota ditahan (${T.tahan.length})</h3>${T.tahan.map(vTahan).join("")}`:""}
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
  document.querySelectorAll("[data-lepas]").forEach(b=>b.onclick=()=>{const k="t"+b.dataset.lepas,y=P.set.yakin;
    if(y&&y.k===k){b.disabled=true;lepasTahan(b.dataset.lepas)}else{P.set.yakin={k};A.render()}});
  document.querySelectorAll("[data-dev]").forEach(b=>b.onclick=()=>{b.disabled=true;putusDev(b.dataset.dev,b.dataset.setuju==="1")})}

/* ---------- Atur ---------- */
const SEKSI=[["menu","Menu"],["metode","Metode bayar"],["diskon","Diskon"],["laci","Laci kas"],["perangkat","Perangkat"],["staf","Staf"]];
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
  const laci=S.me.shift?`<div class="aksi2"><button type="button" class="btn ghost" id="ke-kas">Kas shift saya</button><button type="button" class="btn ghost" id="ke-nota">Nota shift ini</button></div>`:"";
  const kepala=`<section class="card"><div class="head"><h2>Atur</h2><button type="button" class="btn sm ghost" id="atur-muat"${G.memuat?" disabled":""}>Muat ulang</button></div>${tabs}${laci}
    ${G.galat?`<p class="err" role="alert">${esc(G.galat)}</p>`:""}</section>`;
  if(G.sec==="laci")return kepala+vLaci();
  if(!c)return kepala+`<p class="muted tengah">${G.memuat?"Memuat...":""}</p>`;
  return kepala+({menu:vMenuAtur,metode:vMetodeAtur,diskon:vDiskonAtur,perangkat:vPerangkatAtur,staf:vStafAtur}[G.sec])(c)}
function bindAtur(){const G=P.atur;
  const klik=(sel,fn)=>document.querySelectorAll(sel).forEach(b=>b.onclick=()=>fn(b));
  const id=$;const tekan=(i,fn)=>{const b=id(i);if(b)b.onclick=fn};
  tekan("atur-muat",()=>{if(G.sec==="laci")muatKas();else muatAtur()});
  if(G.sec==="laci")bindLaci();
  tekan("ke-kas",()=>A.pindahTab("kas"));tekan("ke-nota",()=>A.pindahTab("nota"));
  klik("[data-seksi]",b=>{G.sec=b.dataset.seksi;G.yakin=null;A.render();if(G.sec==="laci")muatKas()});
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

/* ---------- Atur → Laci kas: ambil / tambah uang laci (pemilik) ---------- */
// Menempel ke shift yang memegang laci (shift berjalan kasir siapa pun, atau tutup toko terakhir). Semua lewat pos_cash_move.
const ALASAN_KAS=["Setor ke bank","Ambil pribadi","Tambah uang kecil"];
const ribuan=d=>String(d||"").replace(/\B(?=(\d{3})+(?!\d))/g,".");
const acakHex=()=>{const b=new Uint8Array(8);crypto.getRandomValues(b);return Array.from(b,x=>x.toString(16).padStart(2,"0")).join("")};
async function muatKas(){const k=P.kas;k.memuat=true;k.galat="";segar("atur");
  try{k.st=await A.rpc("pos_cash_status")}catch(e){k.galat=A.errMsg(e)}
  k.memuat=false;segar("atur")}
const jumlahKas=()=>parseInt(digit(P.kas.jumlah)||"0",10);
const bisaKas=()=>{const k=P.kas;return !k.sibuk&&jumlahKas()>0&&k.alasan.trim().length>=3&&(k.mode!=="ambil"||!!k.foto)};
const teksYakin=()=>{const k=P.kas,ambil=k.mode==="ambil";
  return k.yakin?`Yakin ${ambil?"ambil":"tambah"} ${rp(jumlahKas())}? Ketuk lagi`:ambil?"Catat ambil kas":"Catat tambah kas"};
function vLaci(){const k=P.kas,st=k.st,t=st&&st.target;
  let keadaan;
  if(!st)keadaan=`<p class="muted">${k.memuat?"Memuat...":""}</p>`;
  else if(!t)keadaan=`<p class="muted" id="kas-keadaan">${st.handover_waiting?"Laci sedang diserahterimakan. Catat setelah kasir berikutnya menerima laci.":"Belum ada laci yang bisa dicatat. Buka toko dulu."}</p>`;
  else keadaan=`<p class="small muted" id="kas-keadaan">${t.open?`Shift ${esc(t.cashier||"kasir")} sedang berjalan.`:`Toko sudah tutup (ditutup ${esc(t.cashier||"kasir")} ${esc(A.waktuHP(t.closed_at))}). Dicatat untuk modal saat toko dibuka lagi.`}</p>
    <div class="total"><span>Seharusnya di laci</span><b id="kas-seharusnya">${rp(t.expected)}</b></div>`;
  const kepala=`<section class="card"><h3>Laci kas</h3>${keadaan}
    ${k.galat?`<p class="err" role="alert">${esc(k.galat)}</p>`:""}
    ${k.hasil?`<p class="hasil" role="status" id="kas-hasil"><b>${esc(k.hasil)}</b></p>`:""}
    <div class="aksi2"><button type="button" class="btn${k.mode==="ambil"?"":" ghost"}" data-kas-mode="ambil"${t?"":" disabled"}>Ambil kas</button>
    <button type="button" class="btn${k.mode==="tambah"?"":" ghost"}" data-kas-mode="tambah"${t?"":" disabled"}>Tambah kas</button></div></section>`;
  const form=!k.mode||!t?"":`<section class="card" id="kas-form"><h3>${k.mode==="ambil"?"Ambil uang dari laci":"Tambah uang ke laci"}</h3>
    <label for="kas-jumlah">Jumlah (Rp)<input id="kas-jumlah" inputmode="numeric" autocomplete="off" value="${esc(ribuan(digit(k.jumlah)))}"></label>
    <div class="small muted">Alasan</div>
    <div class="metode" role="group" aria-label="Alasan cepat">${ALASAN_KAS.map(a=>`<button type="button" data-kas-alasan="${esc(a)}" aria-pressed="${k.alasan===a}">${esc(a)}</button>`).join("")}</div>
    <label for="kas-alasan">Tulis alasan (minimal 3 huruf)<input id="kas-alasan" maxlength="200" autocomplete="off" value="${esc(k.alasan)}"></label>
    <div class="fotobox"><button type="button" class="btn ghost" id="kas-foto"${k.sibuk?" disabled":""}>${k.foto?"Ganti foto bukti kas":"Ambil foto bukti kas"}</button>
    ${k.fotoUrl?`<img class="prat" src="${esc(k.fotoUrl)}" alt="Pratinjau foto kas">`:`<span class="small muted">${k.mode==="ambil"?"Foto uang yang diambil wajib.":"Foto boleh dilewati."}</span>`}</div>
    <p class="err" id="kas-pesan" role="alert">${esc(k.pesan)}</p>
    <button type="button" class="btn${k.yakin?" lunas":""}" id="kas-kirim"${bisaKas()?"":" disabled"}>${esc(teksYakin())}</button>
    <button type="button" class="btn ghost" id="kas-batal">Tidak jadi</button></section>`;
  const gerak=st?`<section class="card" id="kas-hari-ini"><h3>Hari ini</h3>${daftarBaris(st.moves,barisGerak)}</section>`:"";
  return kepala+form+gerak}
function resetForm(){const k=P.kas;if(k.fotoUrl)URL.revokeObjectURL(k.fotoUrl);Object.assign(k,{mode:null,jumlah:"",alasan:"",foto:null,fotoUrl:null,fotoPath:null,yakin:false,pesan:""})}
function bindLaci(){const k=P.kas;
  // Ubah isian: tombol kembali ke ketukan pertama (tanpa render ulang supaya ketikan tidak hilang).
  const segarTombol=()=>{k.yakin=false;const b=$("kas-kirim");if(b){b.disabled=!bisaKas();b.textContent=teksYakin();b.classList.remove("lunas")}};
  document.querySelectorAll("[data-kas-mode]").forEach(b=>b.onclick=()=>{const m=b.dataset.kasMode;
    if(k.mode===m)return;resetForm();k.mode=m;k.hasil=null;A.render();const j=$("kas-jumlah");if(j)j.focus()});
  const j=$("kas-jumlah");if(j)j.oninput=()=>{k.jumlah=digit(j.value).replace(/^0+/,"").slice(0,9);j.value=ribuan(k.jumlah);segarTombol()};
  const a=$("kas-alasan");if(a)a.oninput=()=>{k.alasan=a.value;
    document.querySelectorAll("[data-kas-alasan]").forEach(c=>c.setAttribute("aria-pressed",String(c.dataset.kasAlasan===k.alasan)));segarTombol()};
  document.querySelectorAll("[data-kas-alasan]").forEach(c=>c.onclick=()=>{k.alasan=c.dataset.kasAlasan;k.yakin=false;A.render()});
  const f=$("kas-foto");if(f)f.onclick=async()=>{try{const x=await KasirFoto.ambil();const kc=await KasirFoto.kecilkan(x);
      if(k.fotoUrl)URL.revokeObjectURL(k.fotoUrl);k.foto=kc;k.fotoUrl=URL.createObjectURL(kc);k.fotoPath=null;k.pesan="";k.yakin=false;A.render()}
    catch(e){if(!/dibatalkan|Tidak ada foto/.test(e.message))A.toast(A.errMsg(e))}};
  const bt=$("kas-batal");if(bt)bt.onclick=()=>{resetForm();A.render()};
  const kr=$("kas-kirim");if(kr)kr.onclick=()=>{if(!bisaKas())return;if(!k.yakin){k.yakin=true;A.render();return}catatKas()}}
async function catatKas(){const k=P.kas;k.sibuk=true;k.pesan="";A.render();
  try{// Foto terunggah sekali; bila pencatatan gagal lalu diulang, foto yang sama dipakai lagi.
    if(k.foto&&!k.fotoPath){const path=`${S.user.id}/kas-${acakHex()}.jpg`;
      const {error}=await S.sb.storage.from("bukti").upload(path,k.foto,{contentType:"image/jpeg",upsert:false});
      if(error)throw error;k.fotoPath=path}
    const r=await A.rpc("pos_cash_move",{p_kind:k.mode,p_amount:jumlahKas(),p_reason:k.alasan.trim(),p_photo_path:k.fotoPath});
    k.hasil=`${r.kind==="ambil"?"Ambil":"Tambah"} kas ${rp(r.amount)} tercatat. Sekarang seharusnya di laci: ${rp(r.expected)}.`;
    resetForm();k.sibuk=false;P.lap.data=null;P.lap.rg.data=null;await muatKas();return}
  catch(e){k.pesan=A.errMsg(e);k.yakin=false}
  k.sibuk=false;A.render()}

/* ---------- Penghubung ke kasir.js ---------- */
const tahanHp=()=>S.me&&S.me.role==="pemilik"&&S.me.device!=="approved"&&["jual","nota","kas"].includes(S.tab);
function view(tab){
  if(!S.me||S.me.role!=="pemilik")return null;
  if(OWNER_TABS.includes(tab)){if(!mfaOk())return vMfa();return tab==="laporan"?vLaporan():tab==="setujui"?vSetuju():vAtur()}
  if(tahanHp())return `<section class="card"><h2>HP ini belum disetujui</h2>
    <p class="muted">Setujui HP ini dulu di tab Setujui (perlu verifikasi 2 langkah), lalu tekan Cek lagi.</p>
    <button type="button" class="btn" id="cek-hp">Cek lagi</button></section>`;
  return null}
function bind(tab){
  if(!S.me||S.me.role!=="pemilik")return false;
  if(OWNER_TABS.includes(tab)){if(!mfaOk())bindMfa();else if(tab==="laporan")bindLaporan();else if(tab==="setujui")bindSetuju();else bindAtur();return true}
  if(tahanHp()){$("cek-hp").onclick=async()=>{try{await A.muatMe()}catch(e){A.toast(A.errMsg(e))}A.render()};return true}
  return false}
function masuk(tab){if(!OWNER_TABS.includes(tab))return;
  if(!mfaOk()){muatMfa();return}
  if(tab==="laporan"){muatMode();return}
  if(tab==="setujui")muatSetuju();else{if(!P.atur.cat)muatAtur();if(P.atur.sec==="laci")muatKas()}}
// Angka badge Setujui: dimuat diam-diam setelah masuk dan tiap menit.
async function segarBadge(){if(!mfaOk()||!A.daring()||P.set.memuat)return;
  try{const [v,t,d]=await Promise.all([A.rpc("pos_void_pending"),A.rpc("pos_held_list"),A.rpc("pos_devices_list")]);
    const dev=d.filter(x=>x.status==="pending"),b=v.length+t.length+dev.length;
    P.set.void=v;P.set.tahan=t;P.set.dev=dev;if(b!==P.badge){P.badge=b;A.renderTab()}if(S.tab==="setujui")fotoSemua()}catch(e){}}
function sesudahMe(){if(S.me&&S.me.role==="pemilik"&&mfaOk())segarBadge()}
setInterval(()=>{if(S.me&&S.me.role==="pemilik"&&S.tab!=="setujui")segarBadge()},60*1000);
function tabs(){return [["jual","Jual"],["laporan","Laporan"],["setujui","Setujui",P.badge>0?String(P.badge):"" ],["atur","Atur",null,["nota","kas"]]]}
simpanan();
window.KasirPemilik={tabs,view,bind,masuk,sesudahMe,reset(){P=P0();simpanan()}};
})();
