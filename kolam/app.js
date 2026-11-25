/* Kolam Koi · Toko Teh Tjap Dua Koi
   Aplikasi member: tarik kartu dari nota, koleksi kolam, tukar hadiah, peringkat.
   Semua undian & penukaran dihitung di server (Supabase, lihat setup.sql). */
(function(){
"use strict";
const CFG=window.KOLAM_CONFIG||{};
const $=id=>document.getElementById(id);
const rp=n=>"Rp"+Math.round(n).toLocaleString("id-ID");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(m){if(document.querySelector(".reveal")){toast.pending=m;return}const t=$("toast");t.textContent=m;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(()=>t.hidden=true,3200)}

/* ===== aturan (diperbarui dari database saat dibuka) ===== */
const RULE={rate:{R:.80,SR:.17,UR:.03},pts:{R:1,SR:5,UR:25},pitySR:10,pityUR:40,
  pulls:[[100000,5],[80000,4],[60000,3],[45000,2],[20000,1]],
  rewards:[[300,"Hadiah Koi Emas","Tumbler Tjap Dua Koi + 1 minuman gratis tiap bulan selama 3 bulan + nama di Kolam Kehormatan"],[120,"2 minuman jumbo + merchandise","Stiker atau gantungan koi"],[60,"Paket Teman Tarik","2 minuman 14 oz + 1 bagel/wrap"],[30,"1 minuman 14 oz gratis","Teh Tarik, Milo, Matcha atau Houjicha Tarik"],[12,"Upgrade jumbo 22 oz","Untuk 1 minuman"]]};
const pullsFor=t=>{for(const[min,n]of RULE.pulls)if(t>=min)return n;return 0};

/* ===== 12 karakter + 1 rahasia ===== */
const CARDS=[
 {id:"kohaku",t:"R",nm:"Kohaku",bg:"#e9e1cc",p:{b:"#fbf8f1",s:[["#d3352c",.1,-.05,.28],["#d3352c",-.25,.08,.22]]}},
 {id:"showa",t:"R",nm:"Showa",bg:"#dfe6dc",p:{b:"#1d1d1d",s:[["#d3352c",.05,-.02,.3],["#f8f5ee",-.28,.05,.2]]}},
 {id:"sanke",t:"R",nm:"Sanke",bg:"#e6dfd0",p:{b:"#fbf8f1",s:[["#d3352c",0,-.04,.3],["#1d1d1d",-.22,.06,.09],["#1d1d1d",.2,.07,.07]]}},
 {id:"asagi",t:"R",nm:"Asagi",bg:"#dde5e6",p:{b:"#7c95a8",s:[["#e2672f",-.1,.12,.32]]}},
 {id:"ogon",t:"R",nm:"Ogon",bg:"#e8e0cc",p:{b:"#e3b64c",s:[["#f4d88a",.0,-.06,.22]]}},
 {id:"tancho",t:"R",nm:"Tancho",bg:"#e4e8e1",p:{b:"#fbf8f1",s:[["#d3352c",.36,-.01,.09]]}},
 {id:"api",t:"SR",el:"api",nm:"Koi Api",scene:"api",bg:"#2a0c06",p:{b:"#ff7a2f",s:[["#ffd23f",.05,-.05,.26],["#c81d11",-.25,.06,.18]]}},
 {id:"listrik",t:"SR",el:"listrik",nm:"Koi Listrik",scene:"listrik",bg:"#140f2e",p:{b:"#3fd0ff",s:[["#fff36b",.0,-.04,.24]]}},
 {id:"air",t:"SR",el:"air",nm:"Koi Air",scene:"air",bg:"#06344d",p:{b:"#8fe3ff",s:[["#2a8fd6",.05,-.03,.26]]}},
 {id:"batu",t:"SR",el:"batu",nm:"Koi Batu",scene:"batu",bg:"#3a3632",p:{b:"#9a948a",s:[["#5f5a52",.1,-.05,.22],["#c9c2b4",-.2,.06,.14]]}},
 {id:"bulan",t:"UR",el:"bulan",nm:"Koi Bulan",scene:"bulan",bg:"#0b1230",p:{b:"#e9eef8",s:[["#aab8d6",.05,-.05,.2]]}},
 {id:"matahari",t:"UR",el:"matahari",nm:"Koi Matahari",scene:"matahari",bg:"#3a1a02",p:{b:"#ffc83d",s:[["#ff7a1a",.0,-.04,.25],["#fff2b0",.25,-.08,.08]]}}
];
const SECRET={id:"tjap",t:"UR",nm:"Koi Tjap (rahasia)",scene:"tjap",bg:"#7a1f2b",p:{b:"#f6efdf",s:[["#7a1f2b",.0,-.04,.22]]}};
const byId=Object.fromEntries([...CARDS,SECRET].map(c=>[c.id,c]));

/* ilustrasi koi: badan, ekor, sirip, motif */
function koi(cx,cy,len,rot,p,id){const w=len*.34,clip="k"+id+Math.round(cx)+Math.round(cy);
  const spots=p.s.map(([c,dx,dy,r])=>`<ellipse cx="${dx*len}" cy="${dy*len}" rx="${r*len}" ry="${r*len*.62}" fill="${c}"/>`).join("");
  return `<g transform="translate(${cx} ${cy}) rotate(${rot})"><g class="kb">
   <g class="tail"><path d="M${-len*.42} 0 C ${-len*.62} ${-w*.9}, ${-len*.72} ${-w*.9}, ${-len*.76} ${-w*.75} L ${-len*.6} 0 L ${-len*.76} ${w*.75} C ${-len*.72} ${w*.9}, ${-len*.62} ${w*.9}, ${-len*.42} 0Z" fill="${p.b}" opacity=".92"/></g>
   <g class="fin"><path d="M${len*.05} ${-w*.42} q ${-len*.1} ${-w*.75} ${-len*.25} ${-w*.62} q ${len*.05} ${w*.35} ${len*.12} ${w*.5}Z M${len*.05} ${w*.42} q ${-len*.1} ${w*.75} ${-len*.25} ${w*.62} q ${len*.05} ${-w*.35} ${len*.12} ${-w*.5}Z" fill="${p.b}" opacity=".85"/></g>
   <clipPath id="${clip}"><ellipse cx="0" cy="0" rx="${len*.5}" ry="${w/2}"/></clipPath>
   <ellipse cx="0" cy="0" rx="${len*.5}" ry="${w/2}" fill="${p.b}"/>
   <g clip-path="url(#${clip})">${spots}<ellipse cx="0" cy="${-w*.12}" rx="${len*.45}" ry="${w*.12}" fill="#fff" opacity=".18"/></g>
   <circle cx="${len*.36}" cy="${-w*.18}" r="${len*.025}" fill="#111"/>
   <path d="M${len*.48} ${w*.06} q ${len*.06} ${w*.2} ${len*.02} ${w*.35}" stroke="${p.b}" stroke-width="${len*.012}" fill="none"/>
  </g></g>`}
function art(c){const W=300,H=400;let bg=`<rect width="${W}" height="${H}" fill="${c.bg}"/>`,extra="",body="";
  const ripple=(n,col)=>Array.from({length:n},(_,i)=>`<ellipse cx="${150+Math.sin(i*2.1)*90}" cy="${70+i*60}" rx="${40+i*6}" ry="${8+i}" fill="none" stroke="${col}" stroke-width="2" opacity=".35"/>`).join("");
  if(c.t==="R"){bg+=ripple(6,"#9fb7ae");bg+=`<circle cx="230" cy="80" r="26" fill="#3f7d4f" opacity=".55"/><circle cx="70" cy="320" r="20" fill="#3f7d4f" opacity=".45"/>`;body=koi(150,200,210,-24,c.p,c.id)}
  else if(c.scene==="api"){for(let i=0;i<9;i++){const x=20+i*33,h=90+(i*53)%90;bg+=`<path d="M${x} 400 Q ${x-18} ${400-h*.6} ${x} ${400-h} Q ${x+18} ${400-h*.6} ${x} 400Z" fill="${i%2?"#ff5a1f":"#ffb23f"}" opacity=".75"/>`}
    for(let i=0;i<16;i++)bg+=`<circle cx="${(i*67)%300}" cy="${(i*41)%300}" r="${1+i%3}" fill="#ffd23f" opacity=".7"/>`;body=koi(150,200,210,-28,c.p,c.id)}
  else if(c.scene==="listrik"){bg+=`<path d="M60 0 L40 120 L80 120 L50 260" stroke="#fff36b" stroke-width="5" fill="none" opacity=".85"/><path d="M250 30 L230 140 L265 140 L235 290" stroke="#7fe8ff" stroke-width="4" fill="none" opacity=".8"/>`;
    for(let i=0;i<5;i++)bg+=`<circle cx="150" cy="200" r="${60+i*28}" fill="none" stroke="#3fd0ff" stroke-width="1.5" stroke-dasharray="6 10" opacity="${.5-i*.08}"/>`;body=koi(150,205,210,-20,c.p,c.id)}
  else if(c.scene==="air"){for(let i=0;i<22;i++)bg+=`<circle cx="${(i*71)%300}" cy="${(i*97)%400}" r="${3+(i%4)*3}" fill="none" stroke="#bff0ff" stroke-width="1.5" opacity=".55"/>`;
    bg+=`<path d="M0 320 Q 75 300 150 320 T 300 320 V400 H0Z" fill="#0b5a7d" opacity=".7"/>`;body=koi(150,190,210,-26,c.p,c.id)}
  else if(c.scene==="batu"){for(let i=0;i<7;i++){const x=(i*61)%300,y=260+(i*37)%120;bg+=`<ellipse cx="${x}" cy="${y}" rx="${40+i*5}" ry="${22+i*3}" fill="${i%2?"#57524b":"#6b665d"}"/>`}
    bg+=`<path d="M40 60 l30 20 l-10 30 M230 90 l-20 25 l15 30" stroke="#8a847a" stroke-width="3" fill="none"/>`;body=koi(150,180,210,-18,c.p,c.id)+`<path d="M120 170 l15 10 l-6 12 M175 185 l10 -8" stroke="#3a3632" stroke-width="3" fill="none" transform="rotate(-18 150 180)"/>`}
  else if(c.scene==="bulan"){for(let i=0;i<40;i++)bg+=`<circle cx="${(i*73)%300}" cy="${(i*131)%400}" r="${(i%3)+.6}" fill="#fff" opacity="${.3+(i%4)*.15}"/>`;
    bg+=`<circle cx="150" cy="150" r="95" fill="#f3f1e6"/><circle cx="120" cy="125" r="14" fill="#dcd8c6"/><circle cx="180" cy="175" r="20" fill="#dcd8c6"/><circle cx="165" cy="110" r="8" fill="#dcd8c6"/>`;body=koi(150,290,190,-10,c.p,c.id)}
  else if(c.scene==="matahari"){for(let i=0;i<16;i++){const a=i*Math.PI/8;bg+=`<path d="M150 170 L${150+Math.cos(a-.09)*260} ${170+Math.sin(a-.09)*260} L${150+Math.cos(a+.09)*260} ${170+Math.sin(a+.09)*260}Z" fill="#ffb23f" opacity=".28"/>`}
    bg+=`<circle cx="150" cy="170" r="80" fill="#ffd45c"/><circle cx="150" cy="170" r="62" fill="#ffe89a"/>`;body=koi(150,250,200,-16,c.p,c.id)}
  else if(c.scene==="tjap"){bg+=`<rect x="40" y="70" width="220" height="260" fill="none" stroke="#f6efdf" stroke-width="8"/><text x="150" y="250" text-anchor="middle" font-size="180" font-weight="700" fill="#f6efdf" font-family="'Noto Serif SC','Songti SC',serif">茶</text>`;body=koi(150,120,120,0,c.p,c.id)}
  return `<svg viewBox="0 0 300 400" role="img" aria-label="${c.nm}">${extra}${bg}${body}</svg>`}
const ELN={api:"API",listrik:"LISTRIK",air:"AIR",batu:"BATU",bulan:"BULAN",matahari:"MATAHARI"};
const cardHTML=(c,cls,count)=>`<div class="kc ${c.t} ${cls||""}">${art(c)}<span class="tag">${c.t}</span>${c.el?`<span class="el">${ELN[c.el]}</span>`:""}${count>1?`<span class="cnt">×${count}</span>`:""}<span class="nm">${c.nm}</span></div>`;

/* ===== state: dari server + pilihan tampilan di HP ini ===== */
let sb=null,S=null,phone="",legacy=false,legacyOpen=false,tab="tarik",sel={},lbCat="tukar",queue=[],board=null,busy=false;
const LKEY=()=>"kolamkoi-v1-"+phone;
const LOCAL=["skin","customBg","avatar","avatarPos","wait"];
function save(){if(!S)return;const o={};LOCAL.forEach(k=>{if(S[k]!==undefined)o[k]=S[k]});try{localStorage.setItem(LKEY(),JSON.stringify(o))}catch(e){toast("Penyimpanan HP penuh. Foto kolam tidak tersimpan.")}}
function loadLocal(){try{return JSON.parse(localStorage.getItem(LKEY()))||{}}catch(e){return {}}}
const owned=()=>Object.entries(S.inv).filter(([,n])=>n>0);
const distinct=()=>S.ever.filter(x=>x!=="tjap").length;
const totalPts=()=>owned().reduce((s,[id,n])=>s+RULE.pts[byId[id].t]*n,0);

async function rpc(fn,args){const {data,error}=await sb.rpc(fn,args||{});if(error)throw error;return data}
const errMsg=e=>{const m=(e&&e.message)||String(e);if(/Failed to fetch|NetworkError|network/i.test(m))return "Koneksi internet bermasalah. Coba lagi.";if(/JWT|session/i.test(m))return "Sesi habis. Silakan masuk lagi.";return m};

async function loadRules(){try{
  const [t,r,k]=await Promise.all([sb.from("kk_tiers").select("*").order("min_total",{ascending:false}),sb.from("kk_rewards").select("*").order("points",{ascending:false}),sb.from("kk_skins").select("*")]);
  if(t.data&&t.data.length)RULE.pulls=t.data.map(x=>[x.min_total,x.pulls]);
  if(r.data&&r.data.length)RULE.rewards=r.data.map(x=>[x.points,x.name,x.detail]);
  if(k.data)k.data.forEach(x=>{const s=SKINS.find(z=>z.id===x.id);if(s){s.cost=x.cost;s.nm=x.name;s.how="Tukar "+x.cost+" poin"}});
}catch(e){}}

/* Klaim lama (nomor nota + total) bisa dimatikan pemilik di Admin. Gagal dibaca = dianggap mati. */
async function loadLegacy(){legacy=false;try{const {data,error}=await sb.from("kk_settings").select("legacy_nota_claim").eq("id",1).maybeSingle();legacy=!error&&!!data&&data.legacy_nota_claim===true}catch(e){}}
async function loadMe(){const me=await rpc("kk_me");if(!me){S=null;return false}
  await loadLegacy();
  const L=S&&S._phone===me.phone?S:loadLocal();
  S={_phone:me.phone,name:me.nickname,show:me.show_on_board,inv:me.inv||{},ever:me.ever||[],pity:{sr:me.pity_sr,ur:me.pity_ur},bank:me.bank,trx:me.trx,spent:Number(me.spent),
     exchanged:me.exchanged,exMonth:me.ex_month,skinsBought:me.skins||[],vouchers:me.vouchers||[],
     ref:{code:me.ref_code||"",month:me.ref_month||0,total:me.ref_total||0,pending:me.ref_pending||0,max:me.ref_max||15,min:me.ref_min||20000,by:me.referred_by||"",done:!!me.ref_done,canUse:!!me.can_use_ref},
     bonus:me.bonus_pulls||0,postToday:me.post_today||0,postMin:me.post_min||20000,
     skin:L.skin||"klasik",customBg:L.customBg,avatar:L.avatar,avatarPos:L.avatarPos,wait:L.wait||[],_seen:S&&S._seen};
  if(!SKINS.some(k=>k.id===S.skin&&unlocked(k)))S.skin="klasik";
  return true}

/* ===== tarik ===== */
function showReveal(){if(!queue.length){render();if(toast.pending){const m=toast.pending;toast.pending=null;toast(m)}return}
  const c=queue.shift();const isNew=!S._seen||!S._seen.includes(c.id);S._seen=[...(S._seen||[]),c.id];
  const ov=document.createElement("div");ov.className="reveal r-"+c.t;ov.setAttribute("role","dialog");ov.setAttribute("aria-label","Hasil tarikan");
  ov.innerHTML=`<div class="rv"><p class="small" style="opacity:.8">Ketuk kartu untuk membuka · sisa ${queue.length}</p>
   <div class="flip" tabindex="0"><div class="in"><div class="face back"><svg viewBox="0 0 300 400" width="100%" height="100%"><rect width="300" height="400" fill="#0e4d32"/><circle cx="150" cy="200" r="90" fill="none" stroke="#b58a3c" stroke-width="6"/>${koi(150,175,120,0,{b:"#f6efdf",s:[]},"bk1")}${koi(150,228,120,180,{b:"#d9602a",s:[]},"bk2")}<text x="150" y="350" text-anchor="middle" font-family="Georgia,serif" font-size="20" letter-spacing="6" fill="#b58a3c">TJAP DUA KOI</text></svg></div>
   <div class="face front glow-${c.t}">${cardHTML(c)}</div></div></div>
   <div class="rl ${c.t}" hidden>${c.t==="R"?"RARE":c.t==="SR"?"SUPER RARE":"ULTRA RARE"}</div>
   <p class="nmx" hidden><b>${c.nm}</b> · +${RULE.pts[c.t]} poin<br><span style="opacity:.75;font-size:13px">Sudah masuk ke kolam</span></p>
   <button class="btn gold" hidden>${queue.length?"Tarik berikutnya":"Masukkan ke kolam"}</button></div>`;
  document.body.append(ov);const f=ov.querySelector(".flip"),b=ov.querySelector("button");
  const open=()=>{if(f.classList.contains("open"))return;f.classList.add("open");ov.classList.add("open");setTimeout(()=>{ov.querySelector(".rl").hidden=false;ov.querySelector(".nmx").hidden=false;b.hidden=false;b.focus()},650)};
  f.addEventListener("click",open);f.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open()}});
  b.addEventListener("click",()=>{ov.remove();showReveal()});f.focus()}

/* ===== tampilan ===== */
const ICON={tarik:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',kolam:'<path d="M3 12c3-4 6-4 9 0s6 4 9 0M3 17c3-4 6-4 9 0s6 4 9 0M7 7c2-2 4-2 6 0"/>',tukar:'<path d="M4 8h13l-3-3M20 16H7l3 3"/>',peringkat:'<path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',akun:'<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>'};
const TABS=[["tarik","Tarik"],["kolam","Kolam"],["tukar","Tukar"],["peringkat","Peringkat"],["akun","Akun"]];
function nav(){const n=$("tabs");n.hidden=!S;if(!S){n.innerHTML="";return}
  n.innerHTML=TABS.map(([k,l])=>`<button type="button" data-k="${k}" ${k===tab?'aria-current="page"':""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>${l}</button>`).join("");
  n.querySelectorAll("button").forEach(b=>b.onclick=()=>{tab=b.dataset.k;sel={};render();scrollTo(0,0)})}
const LAMP=`<svg class="lamp" viewBox="0 0 96 64" aria-hidden="true"><path d="M0 4q48 16 96 0" fill="none" stroke="#C9A24B" stroke-width="1.5"/>${[[22,9],[52,13],[80,8]].map(([x,y],i)=>`<g transform="translate(${x} ${y})"><line x1="0" y1="0" x2="0" y2="6" stroke="#C9A24B" stroke-width="1.5"/><rect x="-5" y="5" width="10" height="3" rx="1" fill="#1F2A25"/><ellipse cx="0" cy="17" rx="9" ry="11" fill="${i===1?"#D9822B":"#B3262E"}" stroke="#1F2A25" stroke-width="1.5"/><path d="M0 6v22M-5 8q-3 9 0 18M5 8q3 9 0 18" stroke="#1F2A25" stroke-width="1" fill="none" opacity=".5"/><rect x="-4" y="27" width="8" height="3" rx="1" fill="#1F2A25"/></g>`).join("")}</svg>`;
const BACK=`<a class="back" href="../" aria-label="Kembali ke website toko"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></a>`;
function top(inner){return `<header class="top">${LAMP}<div class="brand">${BACK}<div><span class="tjap">TJAP DUA KOI</span><h1>Kolam Koi</h1></div></div>${inner||""}</header>`}
function header(){return top(`<p class="hi">Halo, <b>${esc(S.name)}</b></p>
 <div class="wallet"><div><b>${totalPts()}</b><span>poin kartu</span></div><div><b>${Math.min(distinct(),12)}<small style="font-size:16px;opacity:.7">/12</small></b><span>koleksi</span></div><div><b>${S.exchanged}</b><span>ditukar${S.bank?` · saldo ${S.bank}`:""}</span></div></div>`)}
const REF_URL=c=>location.origin+location.pathname.replace(/[^/]*$/,"")+"?ref="+encodeURIComponent(c);
const refText=()=>`Halo! Daftar Kolam Koi di Toko Teh Tjap Dua Koi pakai kodeku ${S.ref.code}. Belanja minimal ${rp(S.ref.min)}, kamu dapat es teh gratis. Daftar di sini: ${REF_URL(S.ref.code)}`;
const ICO_ES=`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6h12l-1.6 13.2a2 2 0 0 1-2 1.8H9.6a2 2 0 0 1-2-1.8z"/><path d="M5 6h14M13 6l2-4"/></svg>`;
function vBonus(){return S.bonus?`<section class="card" style="border-color:var(--gold)"><h2>Tarikan bonus: ${S.bonus}</h2><p class="small muted">Hadiah dari bonus posting. Langsung tarik, tidak perlu nota.</p><button class="btn gold" id="bp">Tarik kartu bonus</button></section>`:""}
function vAjak(){const R=S.ref;if(!R.code)return "";/* database belum diperbarui */const penuh=R.month>=R.max;
  let pakai="";
  if(R.by&&!R.done)pakai=`<section class="card" style="border-color:var(--gold)"><h2>Kamu diajak ${esc(R.by)}</h2><p class="small">Belanja minimal <b>${rp(R.min)}</b>, lalu masukkan kode dari notanya di atas. Kamu langsung dapat <b>es teh gratis</b> di Hadiahku, dan ${esc(R.by)} juga dapat satu.</p></section>`;
  else if(R.canUse)pakai=`<section class="card"><h2>Punya kode dari teman?</h2><p class="small muted">Masukkan sebelum belanja pertama. Belanja minimal ${rp(R.min)}, kamu dan temanmu sama-sama dapat es teh gratis.</p>
   <label for="rc">Kode teman<input id="rc" class="txt" autocomplete="off" autocapitalize="characters" placeholder="mis. RINA-7KQ"></label><button type="button" class="btn" id="rcb">Pakai kode</button></section>`;
  return pakai+`<section class="card"><div class="row"><h2>Ajak Teman Tarik</h2>${ICO_ES}</div>
  <p class="small">Bagikan kodemu. Teman yang <b>baru daftar</b> pakai kodemu dan belanja minimal <b>${rp(R.min)}</b> dapat <b>es teh gratis</b>. Kamu juga dapat <b>es teh gratis</b> untuk tiap teman yang berhasil.</p>
  <div class="voucher" style="text-align:center"><span class="small muted">Kode ajakmu</span><code style="font-size:24px;letter-spacing:.06em">${esc(R.code)}</code></div>
  <div class="row" style="gap:8px;flex-wrap:wrap"><a class="btn gold" style="flex:1;display:grid;place-items:center;text-decoration:none;min-width:150px" target="_blank" rel="noopener" id="rwa" href="https://wa.me/?text=${encodeURIComponent(refText())}">Kirim lewat WhatsApp</a>
  <button type="button" class="btn ghost" style="flex:1;min-width:120px" id="rsh">${navigator.share?"Bagikan":"Salin ajakan"}</button></div>
  <div class="small" style="display:grid;gap:4px"><div>Berhasil bulan ini: <b>${R.month}/${R.max}</b>${penuh?` · <span style="color:var(--marun)">batas bulan ini tercapai, temanmu tetap dapat es teh</span>`:""}</div><div class="bar"><i style="width:${Math.min(100,R.month/R.max*100)}%"></i></div>
  ${R.pending?`<div class="muted">${R.pending} teman sudah daftar, menunggu belanja pertama.</div>`:""}${R.total?`<div class="muted">Total teman berhasil: ${R.total}</div>`:""}</div></section>
  <section class="card"><h2>Bonus posting</h2><p class="small">Posting foto atau story minuman kami dan tag <b>@tokoteh.tjapduakoi</b>. Di hari kamu belanja minimal <b>${rp(S.postMin)}</b> (nota sudah dimasukkan di sini), tunjukkan postingannya ke kasir, lalu pilih: <b>es teh gratis</b> atau <b>1 tarikan kartu koi</b>. 1 kali sehari.</p>${S.postToday?`<p class="small" style="color:var(--koi)">Bonus posting hari ini sudah diambil. Sampai besok!</p>`:""}</section>`}
function waitRows(){return S.wait.map((w,i)=>w.nota&&!legacy?"":`<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><div><b style="font-family:var(--f-mono)">${esc(w.kode||w.nota)}</b>${w.total?`<div class="small muted">${rp(w.total)}</div>`:""}</div><div class="row" style="gap:6px"><button type="button" class="btn sm" data-w="${i}">Cek lagi</button><button type="button" class="btn sm ghost" data-x="${i}" aria-label="Hapus ${esc(w.kode||w.nota)}">Hapus</button></div></div>`).join("")}
function vTarik(){const tiers=RULE.pulls.slice().reverse();
  return header()+vBonus()+`<section class="card"><h2>Masukkan kode</h2><p class="small muted">Ketik kode 10 huruf dan angka dari struk atau pesan WhatsApp kasir. Jumlah tarikan otomatis sesuai total belanja.</p>
  <label for="kode">Kode<input id="kode" class="txt" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="11" placeholder="XXXXX-XXXXX"></label>
  <button class="btn gold" id="go">Cek kode & tarik</button>
  ${legacy?`<p class="small muted" style="margin:0"><a href="#" id="lama">Punya nota lama? Masukkan nomor &amp; total</a></p>
  <div id="lamaf" style="display:${legacyOpen?"grid":"none"};gap:12px"><label for="nota">Nomor nota<input id="nota" class="txt" autocomplete="off" autocapitalize="characters" placeholder="mis. POS-1123-0303"></label>
  <label for="tot">Total belanja di struk (Rp)<input id="tot" inputmode="numeric" autocomplete="off" placeholder="0"></label>
  <button class="btn" id="go-lama">Cek nota & tarik</button></div>`:""}
  <table class="tiers">${tiers.map(([m,n])=>`<tr><td>Belanja mulai ${rp(m)}</td><td>${n} tarikan</td></tr>`).join("")}</table></section>
  ${S.wait.some(w=>w.kode||legacy)?`<section class="card"><h2>Belum bisa dipakai</h2><p class="small muted">Toko belum mendaftarkan nota ini, atau notanya sedang diperiksa. Biasanya tercatat beberapa menit setelah bayar. Tarikanmu tidak hilang.</p>${waitRows()}</section>`:""}
  <section class="card"><h2>Peluang</h2><div class="odds"><div class="R"><b>80%</b><span>Rare</span></div><div class="SR"><b>17%</b><span>Super Rare</span></div><div class="UR"><b>3%</b><span>Ultra Rare</span></div></div>
  <div class="pity"><div>Super Rare dijamin dalam <b>${Math.max(1,RULE.pitySR-S.pity.sr)}</b> tarikan lagi</div><div class="bar"><i style="width:${S.pity.sr/RULE.pitySR*100}%"></i></div>
  <div>Ultra Rare dijamin dalam <b>${Math.max(1,RULE.pityUR-S.pity.ur)}</b> tarikan lagi</div><div class="bar u"><i style="width:${S.pity.ur/RULE.pityUR*100}%"></i></div></div>
  <p class="small muted">Setiap tarikan pasti dapat kartu dan poin. Tidak ada zonk.</p></section>`.replace(/(<section class="card"><h2>Peluang)/,vAjak()+"$1")}
const num=v=>Number(String(v).replace(/\D/g,""))||0;
/* Hadiah Teman Tarik dari klaim pertama (nota lama atau kode): pesan di depan toast. */
const ajakMsg=r=>r&&r.ajak?`Es teh gratis dari ajakan ${r.ajak.oleh} masuk ke Hadiahku (kode ${r.ajak.code}). `:"";
function claimOk(r,pesan){const before=SKINS.filter(unlocked).length;return loadMe().then(()=>{queue=r.cards.map(id=>byId[id]).filter(Boolean);if(r.secret)queue.push(SECRET);save();
  const after=SKINS.filter(unlocked);toast(ajakMsg(r)+(after.length>before?`Skin kolam baru terbuka: ${after[after.length-1].nm}!`:pesan));showReveal()})}
async function claim(nota,total){nota=String(nota||"").trim().toUpperCase();total=num(total);
  if(!nota)return toast("Isi nomor nota dulu.");if(!total)return toast("Isi total belanja dari struk.");if(busy)return;busy=true;
  const go=$("go-lama")||$("go");if(go){go.disabled=true;go.textContent="Mengecek nota..."}
  try{const r=await rpc("kk_claim",{p_nota:nota,p_total:total});
    const drop=()=>{S.wait=S.wait.filter(w=>w.nota!==nota)};
    if(r.status==="ok"){drop();await claimOk(r,`Nota ${nota}: belanja ${rp(r.total)} → ${r.pulls} tarikan`)}
    else if(r.status==="not_found"){if(!S.wait.some(w=>w.nota===nota))S.wait.push({nota,total});save();render();toast(r.left!=null&&r.left<=3?`Nota belum tercatat atau total tidak cocok. Sisa ${r.left} percobaan hari ini.`:"Nota belum tercatat atau total tidak cocok. Coba lagi beberapa menit lagi.")}
    else if(r.status==="used"){drop();save();render();toast(r.mine?`Nota ${nota} sudah kamu pakai.`:`Nota ${nota} sudah dipakai akun lain. Tanyakan ke kasir.`)}
    else if(r.status==="too_small"){drop();await loadMe();save();render();toast(ajakMsg(r)+`Belanja ${rp(r.total)} belum cukup untuk tarikan (minimal ${rp(RULE.pulls[RULE.pulls.length-1][0])}).`)}
    else if(r.status==="blocked"){render();toast("Terlalu banyak percobaan salah hari ini. Coba lagi besok, atau tanyakan ke kasir.")}
  }catch(e){toast(errMsg(e));render()}finally{busy=false}}
async function pullBonus(){if(busy)return;busy=true;const b=$("bp");if(b){b.disabled=true;b.textContent="Menarik..."}
  try{const r=await rpc("kk_pull_bonus");await loadMe();queue=r.cards.map(id=>byId[id]).filter(Boolean);if(r.secret)queue.push(SECRET);save();showReveal()}
  catch(e){toast(errMsg(e));render()}finally{busy=false}}
function bindAjak(){const bp=$("bp");if(bp)bp.onclick=pullBonus;
  const sh=$("rsh");if(sh)sh.onclick=async()=>{const t=refText();
    if(navigator.share){try{await navigator.share({title:"Kolam Koi · Toko Teh Tjap Dua Koi",text:t})}catch(e){}return}
    try{await navigator.clipboard.writeText(t);toast("Ajakan tersalin. Tempel di chat temanmu.")}catch(e){toast("Kodemu: "+S.ref.code)}};
  const rcb=$("rcb");if(rcb)rcb.onclick=async()=>{const c=$("rc").value.trim().toUpperCase();if(!c)return toast("Isi kode dari temanmu.");if(busy)return;busy=true;rcb.disabled=true;
    try{const n=await rpc("kk_use_ref",{p_code:c});await loadMe();toast(`Kode ${n} terpasang. Belanja minimal ${rp(S.ref.min)} untuk es teh gratismu.`);render()}catch(e){toast(errMsg(e));rcb.disabled=false}finally{busy=false}}}

/* Kode dari kasir: XXXXX-XXXXX (10 huruf/angka). Sama seperti claim(), hasil "ok" memakai animasi tarikan yang sama. */
const fmtKode=v=>{const k=String(v||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,10);return k.length>5?k.slice(0,5)+"-"+k.slice(5):k};
const MSG_KODE={expired:"Kode sudah kedaluwarsa.",wrong_phone:"Kode ini untuk nomor HP lain. Masuk dengan nomor yang dipakai saat belanja.",
  pending:"Nota sedang diperiksa toko. Coba lagi nanti.",void:"Nota ini dibatalkan.",staff_own:"Kode dari nota yang kamu buat sendiri tidak bisa diklaim.",
  blocked:"Terlalu banyak percobaan salah hari ini. Coba lagi besok, atau tanyakan ke kasir."};
async function claimCode(kode){kode=fmtKode(kode);
  if(kode.length!==11){toast("Kode terdiri dari 10 huruf dan angka, contoh ABCDE-23456.");return true}if(busy)return true;busy=true;
  const go=$("go");if(go){go.disabled=true;go.textContent="Mengecek kode..."}
  try{const r=await rpc("kk_claim_code",{p_code:kode});
    const drop=()=>{S.wait=S.wait.filter(w=>w.kode!==kode)};
    const tunggu=()=>{if(!S.wait.some(w=>w.kode===kode))S.wait.push({kode});save()};
    if(r.status==="ok"){drop();await claimOk(r,`Belanja ${rp(r.total)} → ${r.pulls} tarikan`)}
    else if(r.status==="not_found"){tunggu();render();toast(r.left!=null&&r.left<=3?`Kode belum dikenali. Periksa lagi hurufnya. Sisa ${r.left} percobaan hari ini.`:"Kode belum dikenali. Periksa lagi hurufnya, atau coba lagi beberapa menit lagi.")}
    else if(r.status==="pending"){tunggu();render();toast(MSG_KODE.pending)}
    else if(r.status==="used"){drop();save();render();toast(r.mine?"Kode ini sudah kamu pakai.":"Kode ini sudah dipakai akun lain. Tanyakan ke kasir.")}
    else if(r.status==="too_small"){drop();await loadMe();save();render();toast(ajakMsg(r)+`Belanja ${rp(r.total)} belum cukup untuk tarikan (minimal ${rp(RULE.pulls[RULE.pulls.length-1][0])}).`)}
    else if(MSG_KODE[r.status]){if(r.status!=="blocked")drop();save();render();toast(MSG_KODE[r.status])}
    else{render();toast("Kode belum bisa dipakai. Coba lagi nanti.")}
    return true
  }catch(e){toast(errMsg(e));render();return false}finally{busy=false}}

/* ?kode= dari tautan WhatsApp: disimpan di sessionStorage dan dibuang dari URL; diklaim begitu member sudah masuk. */
const KKEY="kolamkoi-kode";
function simpanKodeUrl(){try{const u=new URL(location.href),k=u.searchParams.get("kode");if(k===null)return;
  const f=fmtKode(k);if(f.length===11)sessionStorage.setItem(KKEY,f);else setTimeout(()=>toast("Kode di tautan tidak lengkap. Ketik kodenya sendiri di bawah."),300);
  u.searchParams.delete("kode");history.replaceState(null,"",u.pathname+(u.search||"")+u.hash)}catch(e){}}
const kodeTertunda=()=>{try{return sessionStorage.getItem(KKEY)||""}catch(e){return ""}};
function lupakanKode(){try{sessionStorage.removeItem(KKEY)}catch(e){}}
/* Kode tertunda dihapus hanya setelah server menjawab (status apa pun). Gagal jaringan atau sibuk: masuk daftar tunggu supaya bisa "Cek lagi". */
async function klaimTertunda(){const k=kodeTertunda();if(!k||!S)return;tab="tarik";
  if(busy){tunggu(k);return}
  lupakanKode();render();if(!(await claimCode(k)))tunggu(k)}
function tunggu(k){if(!S.wait.some(w=>w.kode===k))S.wait.push({kode:k});save();render()}
function bindTarik(){bindAjak();const k=$("kode");k.oninput=()=>{k.value=fmtKode(k.value)};
  k.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();claimCode(k.value)}};
  $("go").onclick=()=>claimCode(k.value);
  const lama=$("lama");if(lama){const t=$("tot");t.oninput=()=>{const v=num(t.value);t.value=v?v.toLocaleString("id-ID"):""};
    lama.onclick=e=>{e.preventDefault();legacyOpen=!legacyOpen;$("lamaf").style.display=legacyOpen?"grid":"none"};
    $("go-lama").onclick=()=>claim($("nota").value,$("tot").value)}
  document.querySelectorAll("[data-w]").forEach(b=>b.onclick=()=>{const w=S.wait[+b.dataset.w];if(!w)return;if(w.kode)claimCode(w.kode);else claim(w.nota,w.total)});
  document.querySelectorAll("[data-x]").forEach(b=>b.onclick=()=>{S.wait.splice(+b.dataset.x,1);save();render()})}

function vKolam(){const all=[...CARDS,...(S.ever.includes("tjap")?[SECRET]:[])];
  const sec=t=>{const list=all.filter(c=>c.t===t);return `<h3 style="margin-top:4px">${t==="R"?"Rare":t==="SR"?"Super Rare":"Ultra Rare"} <span class="small muted">· ${RULE.pts[t]} poin</span></h3><div class="grid">${list.map(c=>{const n=S.inv[c.id]||0,ever=S.ever.includes(c.id);return cardHTML(c,n?"":ever?"past":"none",n)}).join("")}</div>`};
  return header()+`<div class="pond-wrap"><svg class="pond" id="pond" viewBox="0 0 360 250" role="img" aria-label="Kolam berisi koi milikmu"></svg><span class="cap">${owned().length} koi · ketuk ikannya</span></div>
  <section class="card" style="gap:8px"><div class="row"><h2>Skin kolam</h2><span class="small muted">${S.trx} transaksi · ${rp(S.spent)}</span></div>
  <div class="chips">${SKINS.map(k=>{const u=unlocked(k);return `<button type="button" class="chip" data-skin="${k.id}" aria-pressed="${S.skin===k.id}" style="${S.skin===k.id?"background:var(--koi);color:#fff;border-color:var(--koi)":u?"":"opacity:.6"}">${u?"":`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-label="terkunci" style="vertical-align:-1px;margin-right:3px"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`}${k.nm}</button>`}).join("")}</div>
  <div class="row" style="justify-content:flex-start;gap:8px"><button type="button" class="btn sm ghost" id="pbg">${S.customBg?"Ganti foto kolam":"Pakai foto galeri jadi kolam"}</button><button type="button" class="btn sm ghost" id="pav">${S.avatar?"Ganti ikon foto":"Tambah ikon foto"}</button>${S.avatar?`<button type="button" class="btn sm ghost" id="pdel" style="border-color:var(--muted);color:var(--muted)">Hapus ikon</button>`:""}</div>
  <p class="small muted">${(()=>{const nx=SKINS.find(k=>!unlocked(k)&&!k.cost&&!k.photo);return nx?`Berikutnya: ${nx.nm} · ${nx.prog()}`:"Semua skin dari transaksi sudah terbuka."})()} Foto kolam & ikon hanya tersimpan di HP ini.</p></section>
  <section class="card"><h2>Koleksiku</h2><p class="small muted">Kartu abu-abu gelap belum pernah didapat. Kartu pudar sudah pernah dimiliki lalu ditukar, jadi tetap tercatat di koleksi.</p>
  ${sec("R")}${sec("SR")}${sec("UR")}
  ${S.ever.includes("tjap")?"":`<p class="small" style="color:var(--marun)">Lengkapi ke-12 koi untuk membuka kartu rahasia ke-13.</p>`}</section>`}

const selPts=()=>(S.bank||0)+Object.entries(sel).reduce((s,[id,n])=>s+RULE.pts[byId[id].t]*n,0);
function vTukar(){const list=owned().sort((a,b)=>RULE.pts[byId[b[0]].t]-RULE.pts[byId[a[0]].t]);
  const bank=S.bank||0,pts=selPts(),rw=RULE.rewards.find(([m])=>pts>=m),next=RULE.rewards.slice().reverse().find(([m])=>pts<m);
  const quick=t=>list.filter(([id])=>byId[id].t===t).reduce((s,[,k])=>s+k,0)>=12;
  return header()+`<section class="card"><h2>Tukar kartu</h2><p class="small muted">Pilih kartu apa saja, boleh campur. Poin dijumlah dan kamu dapat hadiah tertinggi yang terjangkau. Sisa poin masuk saldo dan ikut terpakai di penukaran berikutnya.</p>
  <div class="chips">${["R","SR","UR"].map(t=>`<button type="button" class="chip" data-q="${t}" ${quick(t)?"":"disabled style='opacity:.45'"}>Pilih 12 ${t}</button>`).join("")}<button type="button" class="chip" data-q="clear">Kosongkan</button></div>
  <div>${list.length?list.map(([id,n])=>{const c=byId[id];return `<div class="pick">${cardHTML(c)}<div><b style="font-size:14px">${c.nm}</b><div class="small muted">${c.t} · ${RULE.pts[c.t]} poin · punya ${n}</div></div><div class="step"><button type="button" data-d="-1" data-id="${id}" aria-label="Kurangi ${c.nm}">−</button><b>${sel[id]||0}</b><button type="button" data-d="1" data-id="${id}" aria-label="Tambah ${c.nm}">+</button></div></div>`}).join(""):`<p class="muted small">Belum ada kartu. Tarik dulu di tab Tarik.</p>`}</div></section>
  <section class="card"><h2>Tukar ke skin kolam</h2><p class="small muted">Pakai kartu yang dipilih di atas${bank?" dan saldo poinmu":""}.</p>
  ${SKINS.filter(k=>k.cost).map(k=>`<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><div><b>${k.nm}</b><div class="small muted">${k.cost} poin</div></div>${S.skinsBought.includes(k.id)?`<span class="pill ok">sudah dimiliki</span>`:`<button type="button" class="btn sm" data-buy="${k.id}" ${pts>=k.cost?"":"disabled"}>Tukar</button>`}</div>`).join("")}</section>
  <section class="card"><h2>Daftar hadiah</h2><table class="tiers">${RULE.rewards.slice().reverse().map(([m,n,d])=>`<tr class="${rw&&rw[0]===m?"on":""}"><td>${esc(n)}${d?`<div class="small muted" style="font-weight:400">${esc(d)}</div>`:""}</td><td>${m} poin</td></tr>`).join("")}</table></section>
  <section class="card"><h2>Hadiahku</h2>${S.vouchers.length?S.vouchers.map(v=>`<div class="voucher" style="${v.used_at?"opacity:.55;border-style:solid;border-color:var(--line)":""}"><b>${esc(v.nm)}</b><code>${esc(v.code)}</code><span class="small muted">${v.used_at?"Sudah dipakai "+new Date(v.used_at).toLocaleDateString("id-ID",{day:"numeric",month:"short"}):"Tunjukkan kode ke kasir"}</span><span class="small muted">${new Date(v.at).toLocaleDateString("id-ID",{day:"numeric",month:"short"})}</span></div>`).join(""):`<p class="small muted">Belum ada hadiah.</p>`}</section>
  <div class="sum"><div style="display:flex;justify-content:space-between;align-items:baseline"><span class="small muted">Dipilih${bank?` (termasuk saldo ${bank})`:""}</span><b style="font:700 20px var(--f-mono)">${pts} poin</b></div>
  <div class="small">${rw?`Dapat: <b>${esc(rw[1])}</b>${pts-rw[0]?` · sisa ${pts-rw[0]} poin masuk saldo`:""}`:next?`Kurang ${next[0]-pts} poin lagi untuk ${esc(next[1])}`:"Pilih kartu dulu"}</div>
  <button class="btn" id="ex" ${rw?"":"disabled"}>Tukar sekarang</button></div>`}
async function doExchange(skin,btn){if(busy)return;
  if(!btn.dataset.ok){btn.dataset.ok=1;btn.textContent="Ketuk lagi untuk yakin";setTimeout(()=>{if(btn.isConnected&&btn.dataset.ok){delete btn.dataset.ok;btn.textContent=skin?"Tukar":"Tukar sekarang"}},4000);return}
  busy=true;btn.disabled=true;btn.textContent="Menukar...";
  try{const r=await rpc("kk_exchange",{p_cards:sel,p_skin:skin||null});sel={};await loadMe();
    if(skin){S.skin=skin;save();toast(`${(SKINS.find(k=>k.id===skin)||{}).nm} jadi milikmu. Sudah dipasang di kolam.`)}
    else toast(`Ditukar: ${r.item}. Kode ${r.code} ada di Hadiahku.`);render()}
  catch(e){toast(errMsg(e));await loadMe().catch(()=>{});render()}finally{busy=false}}
function bindTukar(){document.querySelectorAll("[data-buy]").forEach(b=>b.onclick=()=>doExchange(b.dataset.buy,b));
  document.querySelectorAll(".step button").forEach(b=>b.onclick=()=>{const id=b.dataset.id,max=S.inv[id]||0;sel[id]=Math.max(0,Math.min(max,(sel[id]||0)+ +b.dataset.d));if(!sel[id])delete sel[id];render()});
  document.querySelectorAll(".chip[data-q]").forEach(b=>b.onclick=()=>{const t=b.dataset.q;sel={};if(t!=="clear"){let need=12;owned().filter(([id])=>byId[id].t===t).forEach(([id,n])=>{const k=Math.min(n,need);if(k){sel[id]=k;need-=k}})}render()});
  const ex=$("ex");if(ex)ex.onclick=()=>doExchange(null,ex)}

const DAY=864e5;
async function loadBoard(){const now=new Date(),prev=new Date(now.getFullYear(),now.getMonth()-1,1);
  const iso=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-01";
  const [a,b]=await Promise.all([rpc("kk_board"),rpc("kk_board",{p_month:iso(prev)})]);board={now:a,prev:b,prevName:prev.toLocaleDateString("id-ID",{month:"long",year:"numeric"})}}
function vPeringkat(){if(!board){loadBoard().then(render).catch(e=>toast(errMsg(e)));return header()+`<section class="card"><h2>Kolam Kehormatan</h2><p class="small muted">Memuat peringkat...</p></section>`}
  const now=new Date(),end=new Date(now.getFullYear(),now.getMonth()+1,1),left=Math.ceil((end-now)/DAY),bln=now.toLocaleDateString("id-ID",{month:"long",year:"numeric"}),start=new Date(now.getFullYear(),now.getMonth(),1).getTime();
  const fmtDur=t=>{t=new Date(t).getTime();const d=Math.floor((t-start)/DAY),h=Math.floor((t-start)%DAY/36e5);return `${d} hari ${h} jam`};
  const N=board.now.total_cards||12;
  let rows=(board.now[lbCat]||[]).map(r=>({...r}));
  if(!rows.some(r=>r.me))rows.push({n:S.name,v:lbCat==="tukar"?S.exMonth:0,me:true,t:null});
  const med=["#e0b860","#c9cfd3","#c98a4b"];
  const val=r=>lbCat==="koleksi"?(r.t?`<span style="color:var(--koi)">${N}/${N}</span><div class="small muted" style="font-family:var(--f-body);font-weight:500">lengkap dalam ${fmtDur(r.t)}</div>`:`${r.v}/${N}`):`${r.v} <span class="small muted">poin</span>`;
  const desc={tukar:"Poin yang ditukar bulan ini.",koleksi:`Siapa paling cepat mengumpulkan ke-${N} koi bulan ini. Yang belum lengkap diurutkan dari jumlah koinya.`}[lbCat];
  const top=k=>{const r=(board.prev[k]||[])[0];return r?esc(r.n):"–"};
  return header()+`<section class="card"><div class="row"><h2>Kolam Kehormatan</h2><span class="pill wait">reset ${left} hari lagi</span></div>
  <div class="prize"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M10 9h20l-2.4 24a2 2 0 0 1-2 1.8H14.4a2 2 0 0 1-2-1.8z" fill="#F6EFDF" stroke="#1F2A25" stroke-width="2"/><path d="M9 9h22M22 9l3-6" stroke="#1F2A25" stroke-width="2" stroke-linecap="round"/><path d="M12 17h16" stroke="#C9A24B" stroke-width="3"/></svg><span>Juara 1 tiap kategori dapat <b>1 minuman gratis</b>. Papan kembali ke nol tiap tanggal 1.</span></div><p class="small muted">${bln}</p>
  <div class="seg" role="group" aria-label="Kategori">${[["tukar","Penukar"],["koleksi","Kolektor"]].map(([k,l])=>`<button type="button" data-c="${k}" aria-pressed="${k===lbCat}">${l}</button>`).join("")}</div>
  <p class="small">${desc}</p>
  <div>${rows.map((r,i)=>`<div class="lb ${r.me?"me":""}"><div class="rk">${i<3?`<span class="medal" style="background:${med[i]}">${i+1}</span>`:i+1}</div><div>${r.me&&S.avatar?`<img src="${S.avatar}" alt="" style="width:26px;height:26px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:6px;border:2px solid var(--gold)">`:""}<b>${esc(r.n)}${r.me?" (kamu)":""}</b>${i===0&&(r.v>0)?`<div class="small" style="color:var(--gold)">Calon pemenang minuman gratis</div>`:""}</div><div class="v" style="text-align:right">${val(r)}</div></div>`).join("")}</div>
  <p class="small muted">Nama yang tampil adalah nama panggilan pilihan pelanggan. Bisa disembunyikan di tab Akun.</p></section>
  <section class="card"><h2>Juara ${board.prevName}</h2><div class="small" style="display:grid;gap:4px"><div>Penukar terbanyak: <b>${top("tukar")}</b></div><div>Kolektor tercepat: <b>${top("koleksi")}</b></div></div><p class="small muted">Pemenang diumumkan di Story Instagram setiap tanggal 1.</p></section>`}
function bindPeringkat(){document.querySelectorAll(".seg button").forEach(b=>b.onclick=()=>{lbCat=b.dataset.c;render()})}

function waLink(t){return "https://wa.me/"+(CFG.waNomor||"6281345306571")+"?text="+encodeURIComponent(t)}
function vAkun(){return header()+`<section class="card"><h2>Akunku</h2>
  <p class="small muted">Nomor HP: <b style="font-family:var(--f-mono)">0${esc(S._phone.slice(2))}</b></p>
  <label for="nn">Nama panggilan (tampil di peringkat)<input id="nn" class="txt" style="text-transform:none" maxlength="24" value="${esc(S.name)}"></label>
  <label style="display:flex;gap:10px;align-items:center;color:var(--ink)"><input type="checkbox" id="show" style="width:22px;height:22px" ${S.show?"checked":""}> Tampilkan namaku di Kolam Kehormatan</label>
  <button type="button" class="btn" id="sv">Simpan</button></section>
  <section class="card"><h2>Lupa PIN?</h2><p class="small muted">PIN bisa direset oleh pemilik toko. Hubungi kami lewat WhatsApp dari nomor HP yang terdaftar.</p>
  <a class="btn ghost" style="display:grid;place-items:center;text-decoration:none" target="_blank" rel="noopener" href="${waLink("Halo Toko Teh Tjap Dua Koi! Aku mau reset PIN Kolam Koi untuk nomor 0"+S._phone.slice(2))}">Chat WhatsApp toko</a></section>
  <section class="card"><h2>Aturan singkat</h2><ul class="small" style="margin:0;padding-left:18px;display:grid;gap:4px">
  <li>Satu nota hanya bisa dipakai satu kali oleh satu akun.</li><li>Jumlah tarikan mengikuti total belanja di nota.</li><li>Kode hadiah ditunjukkan ke kasir dan berlaku sekali.</li><li>Kartu, poin, dan hadiah tidak bisa diuangkan.</li><li>Kode ajak hanya untuk member baru, dipakai sebelum belanja pertama. Satu nomor HP satu akun.</li><li>Es teh ajak teman berlaku setelah teman belanja minimal ${rp(S.ref.min)}. Pengajak maksimal ${S.ref.max} es teh per bulan.</li><li>Bonus posting: hanya di hari kamu belanja minimal ${rp(S.postMin)}, 1 kali sehari, ditunjukkan ke kasir.</li><li>Toko berhak membatalkan kartu dari nota yang tidak sah.</li></ul></section>
  <button type="button" class="btn ghost" id="out">Keluar</button>`}
function bindAkun(){$("sv").onclick=async()=>{const n=$("nn").value.trim();if(!n)return toast("Nama panggilan tidak boleh kosong.");
    try{await rpc("kk_update_profile",{p_nickname:n,p_show:$("show").checked});await loadMe();board=null;toast("Tersimpan.");render()}catch(e){toast(errMsg(e))}};
  $("out").onclick=async()=>{await sb.auth.signOut().catch(()=>{});S=null;board=null;tab="tarik";authMode="masuk";render()}}

/* ===== masuk / daftar ===== */
const URL_REF=(()=>{try{return (new URLSearchParams(location.search).get("ref")||"").trim().toUpperCase().slice(0,16)}catch(e){return ""}})();
let authMode=URL_REF?"daftar":"masuk";
function normPhone(v){let d=String(v||"").replace(/\D/g,"");if(d.startsWith("0"))d="62"+d.slice(1);else if(d.startsWith("8"))d="62"+d;return /^62\d{8,13}$/.test(d)?d:null}
const mail=p=>p+"@member.tjapduakoi.id";
function vAuth(){const d=authMode==="daftar";
  return `<section class="card hero"><span class="tjap">TJAP DUA KOI</span><h1>Kolam Koi</h1><svg viewBox="0 0 300 200" width="220" aria-hidden="true"><circle cx="150" cy="100" r="90" fill="none" stroke="var(--gold)" stroke-width="5"/>${koi(150,78,120,0,{b:"#e9e1cc",s:[["#d3352c",.1,-.05,.28]]},"h1")}${koi(150,128,120,180,{b:"#d9602a",s:[]},"h2")}</svg>
  <ol class="steps"><li>Belanja di Toko Teh Tjap Dua Koi</li><li>Tarik kartu koi dari notamu</li><li>Kumpulkan poin, tukar minuman gratis</li></ol>
  ${kodeTertunda()?`<p class="small" id="info-kode"><b>Masuk atau daftar dulu.</b> Kodemu sudah tersimpan dan langsung dipakai setelah itu.</p>`:""}
  ${URL_REF?`<p class="small" style="background:var(--gold);color:#1b1408;padding:10px 12px;border-radius:12px;border:2px solid var(--ink)">Kamu diajak teman! Daftar dengan kode <b>${esc(URL_REF)}</b>, lalu belanja minimal Rp20.000: dapat <b>es teh gratis</b>.</p>`:""}</section>
  <section class="card"><div class="seg" role="group" aria-label="Pilih"><button type="button" data-m="masuk" aria-pressed="${!d}">Masuk</button><button type="button" data-m="daftar" aria-pressed="${d}">Daftar baru</button></div>
  <form id="af" style="display:grid;gap:12px" novalidate>
  <label for="hp">Nomor HP (WhatsApp)<input id="hp" class="txt" inputmode="tel" autocomplete="tel" placeholder="0812 3456 7890" required></label>
  ${d?`<label for="nk">Nama panggilan<input id="nk" class="txt" style="text-transform:none" maxlength="24" autocomplete="nickname" placeholder="mis. Rina K." required></label>
  <label for="rf">Kode dari teman (kalau ada)<input id="rf" class="txt" autocomplete="off" autocapitalize="characters" placeholder="mis. RINA-7KQ" value="${esc(URL_REF)}"></label>`:""}
  <label for="pin">PIN 6 angka<input id="pin" class="txt" type="password" inputmode="numeric" maxlength="6" autocomplete="${d?"new-password":"current-password"}" placeholder="••••••" required></label>
  ${d?`<label for="pin2">Ulangi PIN<input id="pin2" class="txt" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" placeholder="••••••" required></label>
  <p class="small muted">PIN dipakai untuk masuk dari HP mana pun. Jangan beri tahu siapa pun, termasuk kasir.</p>`:""}
  <button class="btn gold" id="ab" type="submit">${d?"Daftar & mulai":"Masuk"}</button></form>
  ${d?"":`<p class="small muted">Lupa PIN? <a href="${waLink("Halo Toko Teh Tjap Dua Koi! Aku lupa PIN Kolam Koi.")}" target="_blank" rel="noopener">Chat WhatsApp toko</a> untuk reset.</p>`}</section>`}
function bindAuth(){document.querySelectorAll("[data-m]").forEach(b=>b.onclick=()=>{authMode=b.dataset.m;render()});
  $("af").onsubmit=async e=>{e.preventDefault();if(busy)return;const p=normPhone($("hp").value),pin=$("pin").value.trim();
    if(!p)return toast("Nomor HP belum benar. Contoh: 0812 3456 7890");if(!/^\d{6}$/.test(pin))return toast("PIN harus 6 angka.");
    const d=authMode==="daftar";let nk="";
    let rf="";if(d){rf=$("rf").value.trim().toUpperCase();nk=$("nk").value.trim();if(!nk)return toast("Isi nama panggilan.");if($("pin2").value.trim()!==pin)return toast("PIN tidak sama. Ulangi.");if(/^(\d)\1{5}$|^123456$|^654321$/.test(pin))return toast("PIN terlalu mudah ditebak. Pilih yang lain.")}
    busy=true;const ab=$("ab");ab.disabled=true;ab.textContent=d?"Mendaftar...":"Masuk...";
    try{let res;
      if(d&&rf){const who=await rpc("kk_ref_check",{p_code:rf}).catch(e=>/function|schema cache/i.test(e.message||"")?"?":Promise.reject(e));if(!who)throw new Error("Kode teman "+rf+" tidak ditemukan. Periksa lagi, atau kosongkan.")}
      if(d){res=await sb.auth.signUp({email:mail(p),password:pin,options:{data:rf?{nickname:nk,ref:rf}:{nickname:nk}}});
        if(res.error){if(/already|registered|exists/i.test(res.error.message))throw new Error("Nomor ini sudah terdaftar. Silakan pilih Masuk.");throw res.error}
        if(!res.data.session)res=await sb.auth.signInWithPassword({email:mail(p),password:pin})}
      else res=await sb.auth.signInWithPassword({email:mail(p),password:pin});
      if(res.error){if(/invalid login|credentials/i.test(res.error.message))throw new Error("Nomor HP atau PIN salah.");if(/not confirmed/i.test(res.error.message))throw new Error("Akun belum aktif. Beri tahu toko: konfirmasi email di Supabase harus dimatikan.");throw res.error}
      phone=p;const ok=await loadMe();if(!ok){await sb.auth.signOut();throw new Error("Akun ini bukan akun member.")}
      tab="tarik";if(d)toast("Selamat datang di Kolam Koi, "+nk+"!"+(S.ref.by?` Kamu diajak ${S.ref.by}.`:""));if(URL_REF)history.replaceState(null,"",location.pathname);render();setTimeout(klaimTertunda,0)}
    catch(err){toast(errMsg(err))}finally{busy=false;if(ab.isConnected){ab.disabled=false;ab.textContent=d?"Daftar & mulai":"Masuk"}}}}

/* ===== foto dari galeri ===== */
function pickImage(max,cb){const i=document.createElement("input");i.type="file";i.accept="image/*";i.onchange=()=>{const f=i.files[0];if(!f)return;const url=URL.createObjectURL(f),im=new Image();
  im.onload=()=>{const k=Math.min(1,max/Math.max(im.width,im.height)),c=document.createElement("canvas");c.width=Math.round(im.width*k);c.height=Math.round(im.height*k);c.getContext("2d").drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(url);
    try{cb(c.toDataURL("image/jpeg",.78))}catch(e){toast("Foto tidak bisa dibaca. Coba foto lain.")}};im.onerror=()=>toast("Foto tidak bisa dibaca. Coba foto lain.");im.src=url};i.click()}
/* ===== skin kolam ===== */
const SKINS=[
 {id:"klasik",nm:"Kolam Klasik",how:"Gratis",ok:()=>true},
 {id:"foto",nm:"Kolam Fotoku",how:"Pakai foto dari galerimu",ok:()=>!!S.customBg,photo:true},
 {id:"teh",nm:"Kolam Teh Tarik",how:"Terbuka setelah 5 transaksi",ok:()=>S.trx>=5,prog:()=>`${Math.min(S.trx,5)}/5 transaksi`},
 {id:"lampion",nm:"Kolam Lampion Malam",how:"Terbuka setelah total belanja Rp300.000",ok:()=>S.spent>=300000,prog:()=>`${rp(Math.min(S.spent,300000))} / Rp300.000`},
 {id:"hujan",nm:"Kolam Hujan Samarinda",how:"Tukar 30 poin",cost:30},
 {id:"bintang",nm:"Kolam Malam Berbintang",how:"Tukar 60 poin",cost:60},
 {id:"mahakam",nm:"Kolam Senja Mahakam",how:"Terbuka setelah 20 transaksi",ok:()=>S.trx>=20,prog:()=>`${Math.min(S.trx,20)}/20 transaksi`}];
const unlocked=k=>k.cost?S.skinsBought.includes(k.id):k.ok();
function pondBG(id,W,H){const g=(a,b,c)=>`<defs><radialGradient id="wt" cx=".5" cy=".45" r=".8"><stop offset="0" stop-color="${a}"/><stop offset=".7" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#wt)"/>`;
  const rip=col=>Array.from({length:5},(_,i)=>`<ellipse class="rip" style="animation-delay:${i*.8}s" cx="${40+i*70}" cy="${40+(i*67)%170}" rx="30" ry="10" fill="none" stroke="${col}" stroke-width="1.5"/>`).join("");
  const pads=(col,fl)=>[[40,205,26],[318,48,22],[300,210,18],[70,40,16]].map(([x,y,r])=>`<g><circle cx="${x}" cy="${y}" r="${r}" fill="${col}"/><path d="M${x} ${y} L${x+r} ${y-r*.35} L${x+r} ${y+r*.1}Z" fill="rgba(0,0,0,.35)"/><circle cx="${x-r*.3}" cy="${y-r*.2}" r="${r*.18}" fill="${fl}"/></g>`).join("");
  let b="",top="";
  if(id==="teh"){b=g("#d9a46a","#b9783f","#7a4a22")+rip("#fff1d6");top=`<circle cx="55" cy="200" r="34" fill="none" stroke="#f6efdf" stroke-width="8" opacity=".5"/><circle cx="310" cy="60" r="20" fill="#3a2414" opacity=".5"/><circle cx="290" cy="80" r="12" fill="#3a2414" opacity=".5"/>`}
  else if(id==="lampion"){b=g("#3a1c1c","#20100f","#0d0606")+rip("#ffcf6e");for(let i=0;i<5;i++){const x=30+i*75;top+=`<line x1="${x}" y1="0" x2="${x}" y2="${14+(i%2)*10}" stroke="#d9b25e"/><ellipse cx="${x}" cy="${30+(i%2)*10}" rx="13" ry="17" fill="#e23b2e"/><ellipse cx="${x}" cy="${30+(i%2)*10}" rx="13" ry="17" fill="#ffcf6e" opacity=".3"/>`;b+=`<ellipse cx="${x}" cy="${190+(i%3)*15}" rx="14" ry="5" fill="#ff8a3a" opacity=".25"/>`}}
  else if(id==="hujan"){b=g("#2f5a58","#1d3d3c","#0e2524")+rip("#cfeee8");for(let i=0;i<40;i++){const x=(i*47)%W,y=(i*89)%H;top+=`<line x1="${x}" y1="${y}" x2="${x-5}" y2="${y+14}" stroke="#cfeee8" stroke-width="1.5" opacity=".4"/>`}top+=pads("#2f7a4f","#cfe9ff")}
  else if(id==="bintang"){b=g("#1a2c52","#0f1d38","#060c1c");for(let i=0;i<45;i++)b+=`<circle cx="${(i*73)%W}" cy="${(i*131)%H}" r="${(i%3)*.6+.5}" fill="#fff" opacity="${.3+(i%4)*.15}"/>`;b+=`<circle cx="290" cy="60" r="26" fill="#f6efdf" opacity=".9"/><circle cx="300" cy="54" r="24" fill="#0f1d38"/>`+rip("#8fb0d8")}
  else if(id==="foto"&&S.customBg){b=`<image href="${S.customBg}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/><rect width="${W}" height="${H}" fill="#06301f" opacity=".28"/>`+rip("#ffffff")}
  else if(id==="mahakam"){b=`<defs><linearGradient id="wt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f29b4b"/><stop offset=".45" stop-color="#b5523a"/><stop offset="1" stop-color="#3a1f3a"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#wt)"/><circle cx="180" cy="70" r="34" fill="#ffd27a" opacity=".85"/>`;for(let i=0;i<6;i++)b+=`<rect x="${120+i*4-i*i}" y="${110+i*18}" width="${120-i*8+2*i*i}" height="3" fill="#ffd27a" opacity="${.5-i*.07}"/>`;top=`<path d="M0 30 L60 22 L120 30 L200 18 L260 28 L360 20 V0 H0Z" fill="#2a1430" opacity=".7"/>`}
  else{b=g("#1f6b55","#0f4536","#082a20")+rip("#9fd8c2");top=pads("#3f8a4c","#f2b7c6")}
  return [b,top]}
const AURA={api:"#ff6a1f",listrik:"#7fe8ff",air:"#8fe3ff",batu:"#c9c2b4",bulan:"#e9eef8",matahari:"#ffc83d"};
/* ===== kolam animasi ===== */
let pondRAF=0;
function startPond(){cancelAnimationFrame(pondRAF);const svg=$("pond");if(!svg)return;const W=360,H=250;
  const [bg,top]=pondBG(S.skin,W,H);
  const fishes=owned().map(([id])=>byId[id]).slice(0,13);
  const fishSVG=fishes.map((c,i)=>`<g class="fish" data-n="${c.nm}" id="f${i}"><g class="fx" ${c.el?`style="filter:drop-shadow(0 0 ${c.t==="UR"?7:4}px ${AURA[c.el]})"`:""}>${koi(0,0,c.t==="UR"?64:c.t==="SR"?56:48,0,c.p,"p"+i)}</g></g>`).join("");
  const AV=S.avatar?`<g id="ava" style="cursor:grab"><defs><clipPath id="avc"><circle r="22"/></clipPath></defs><circle r="26" fill="#f6efdf"/><circle r="24.5" fill="none" stroke="#b58a3c" stroke-width="2"/><image href="${S.avatar}" x="-22" y="-22" width="44" height="44" clip-path="url(#avc)" preserveAspectRatio="xMidYMid slice"/></g>`:"";
  svg.innerHTML=bg+`<g id="fxl"></g>`+fishSVG+top+AV+`<rect width="${W}" height="${H}" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="6"/>`;
  const fxl=document.getElementById("fxl"),NS="http://www.w3.org/2000/svg";let parts=[];
  const spawn=(x,y,col,kind)=>{if(parts.length>70)return;const e=document.createElementNS(NS,kind==="heart"?"path":"circle");
    if(kind==="heart"){e.setAttribute("d","M0 3 C -6 -3, -3 -8, 0 -4 C 3 -8, 6 -3, 0 3Z")}else e.setAttribute("r",kind==="bub"?2.5:1.8);
    e.setAttribute("fill",kind==="bub"?"none":col);if(kind==="bub"){e.setAttribute("stroke",col);e.setAttribute("stroke-width","1")}fxl.append(e);
    parts.push({e,x,y,vx:(Math.random()-.5)*(kind==="heart"?1.4:.4),vy:kind==="heart"?-1-Math.random():kind==="bub"?-.5:-.2-Math.random()*.4,life:kind==="heart"?60:45,max:kind==="heart"?60:45,kind})};
  const st=fishes.map((c,i)=>({c,x:40+Math.random()*280,y:40+Math.random()*170,a:Math.random()*6.28,v:.35+Math.random()*.35,tx:30+Math.random()*300,ty:30+Math.random()*190,t:0,dance:0,el:document.getElementById("f"+i)}));
  const DANCE=["putar","lompat","goyang"];
  st.forEach(f=>{f.el.onclick=()=>{f.dance=90;f.mode=DANCE[Math.floor(Math.random()*3)];for(let k=0;k<6;k++)spawn(f.x,f.y-6,f.c.el?AURA[f.c.el]:"#ff8fa8","heart");toast(`${f.c.nm} ${f.mode==="putar"?"berputar senang":f.mode==="lompat"?"melompat":"bergoyang"}!`)}});
  const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;let tick=0;
  const av=document.getElementById("ava");let ap=S.avatarPos||{x:300,y:190},drag=null,bounce=0;
  if(av){const toSvg=e=>{const r=svg.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*W,y:(e.clientY-r.top)/r.height*H}};
    av.addEventListener("pointerdown",e=>{drag={moved:false};av.setPointerCapture(e.pointerId);e.preventDefault()});
    av.addEventListener("pointermove",e=>{if(!drag)return;const q=toSvg(e);ap={x:Math.max(26,Math.min(W-26,q.x)),y:Math.max(26,Math.min(H-26,q.y))};drag.moved=true});
    av.addEventListener("pointerup",()=>{if(drag&&!drag.moved){bounce=40;for(let k=0;k<6;k++)spawn(ap.x,ap.y-20,"#ff8fa8","heart")}else if(drag){S.avatarPos=ap;save()}drag=null})}
  const step=()=>{tick++;st.forEach(f=>{let rot=f.a*57.3,sc=1,oy=0;
      if(f.dance>0){f.dance--;const p=(90-f.dance)/90;
        if(f.mode==="putar")rot+=p*720;else if(f.mode==="lompat"){oy=-Math.sin(p*Math.PI*2)*14;sc=1+Math.sin(p*Math.PI)*.25}else rot+=Math.sin(p*Math.PI*8)*28;
        if(f.dance%15===0)spawn(f.x,f.y,f.c.el?AURA[f.c.el]:"#ffd0dc","heart")}
      else{const dx=f.tx-f.x,dy=f.ty-f.y;if(Math.hypot(dx,dy)<20||++f.t>600){f.tx=30+Math.random()*300;f.ty=30+Math.random()*190;f.t=0}
        let da=Math.atan2(dy,dx)-f.a;while(da>Math.PI)da-=6.283;while(da<-Math.PI)da+=6.283;f.a+=da*.025;if(!reduce){f.x+=Math.cos(f.a)*f.v;f.y+=Math.sin(f.a)*f.v}}
      if(f.c.el&&!reduce&&tick%(f.c.el==="air"?18:f.c.el==="api"?6:24)===0){const tx=f.x-Math.cos(f.a)*20,ty=f.y-Math.sin(f.a)*20;spawn(tx,ty,AURA[f.c.el],f.c.el==="air"?"bub":"spark")}
      f.el.setAttribute("transform",`translate(${f.x.toFixed(1)} ${(f.y+oy).toFixed(1)}) rotate(${rot.toFixed(1)}) scale(${sc.toFixed(2)})`)});
    if(av){let oy=Math.sin(tick/40)*3,sc=1;if(bounce>0){bounce--;oy-=Math.sin((40-bounce)/40*Math.PI)*16;sc=1+Math.sin((40-bounce)/40*Math.PI)*.15}av.setAttribute("transform",`translate(${ap.x.toFixed(1)} ${(ap.y+oy).toFixed(1)}) scale(${sc.toFixed(2)})`)}
    parts=parts.filter(q=>{q.life--;q.x+=q.vx;q.y+=q.vy;q.e.setAttribute(q.kind==="heart"?"transform":"cx",q.kind==="heart"?`translate(${q.x.toFixed(1)} ${q.y.toFixed(1)})`:q.x.toFixed(1));if(q.kind!=="heart")q.e.setAttribute("cy",q.y.toFixed(1));q.e.setAttribute("opacity",(q.life/q.max).toFixed(2));if(q.life<=0){q.e.remove();return false}return true});
    if(tab==="kolam"&&document.getElementById("pond"))pondRAF=requestAnimationFrame(step)};step();
  const setBg=()=>pickImage(900,d=>{S.customBg=d;S.skin="foto";try{save();render()}catch(e){toast("Foto terlalu besar untuk disimpan.")}});
  const setAv=()=>pickImage(200,d=>{S.avatar=d;save();render();toast("Ikonmu sekarang mengapung di kolam. Geser untuk memindahkan.")});
  $("pbg")&&($("pbg").onclick=setBg);$("pav")&&($("pav").onclick=setAv);
  $("pdel")&&($("pdel").onclick=()=>{delete S.avatar;delete S.avatarPos;save();render()});
  document.querySelectorAll("[data-skin]").forEach(b=>b.onclick=()=>{const k=SKINS.find(x=>x.id===b.dataset.skin);if(k.photo&&!S.customBg)return setBg();if(!unlocked(k))return toast(k.cost?`Tukar di tab Tukar (${k.cost} poin).`:k.how+" · "+k.prog());S.skin=k.id;save();render()})}

function vClosed(){return top()+`<section class="card"><h2>Segera dibuka</h2><p class="muted">Kolam Koi sedang disiapkan. Pantau Instagram <b>@tokoteh.tjapduakoi</b> untuk tanggal mulainya.</p><a class="btn" style="display:grid;place-items:center;text-decoration:none" href="../">Kembali ke website</a></section>`}
function render(){nav();if(!sb){$("app").innerHTML=vClosed();return}
  if(!S){$("app").innerHTML=vAuth();bindAuth();return}
  const v={tarik:vTarik,kolam:vKolam,tukar:vTukar,peringkat:vPeringkat,akun:vAkun}[tab]();$("app").innerHTML=v;
  ({tarik:bindTarik,tukar:bindTukar,peringkat:bindPeringkat,akun:bindAkun,kolam:startPond}[tab]||(()=>{}))()}

async function boot(){
  simpanKodeUrl();
  if(!CFG.supabaseUrl||!CFG.supabaseKey||!window.supabase){render();return}
  sb=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true,storageKey:"kolamkoi-auth"}});
  $("app").innerHTML=`<p class="muted" style="text-align:center;padding:40px 0">Membuka kolam...</p>`;
  await loadRules();
  try{const {data}=await sb.auth.getSession();const em=data.session&&data.session.user.email||"";
    if(em.endsWith("@member.tjapduakoi.id")){phone=em.split("@")[0];await loadMe()}}catch(e){toast(errMsg(e))}
  render();await klaimTertunda();
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&S&&!busy&&!document.querySelector(".reveal"))loadMe().then(()=>{if(tab!=="kolam")render()}).catch(()=>{})})}
boot();
})();
