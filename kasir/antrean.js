/* Antrean nota offline: nota + foto disimpan di HP (IndexedDB "kasir", store "antrean"), dikirim saat ada sinyal.
   Item: {id, uid, payload, foto: Blob, fotoPath, dibuat, error?}. uid = kasir pembuat nota.
   payload = argumen pos_checkout, termasuk kode klaim (dipakai ulang di setiap kiriman). */
(function(g){
"use strict";
const NAMA_DB="kasir",STORE="antrean";
let dbJanji=null;
function bukaDb(){return dbJanji||(dbJanji=new Promise((ok,gagal)=>{const r=g.indexedDB.open(NAMA_DB,1);
  r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:"id"})};
  r.onsuccess=()=>ok(r.result);r.onerror=()=>{dbJanji=null;gagal(r.error)}}))}
async function tx(mode,kerja){const db=await bukaDb();
  return new Promise((ok,gagal)=>{const t=db.transaction(STORE,mode),q=kerja(t.objectStore(STORE));
    t.oncomplete=()=>ok(q?q.result:undefined);t.onerror=t.onabort=()=>gagal(t.error)})}

// Kasir pembuat item (item lama tanpa uid: folder foto = uid).
const milik=it=>it.uid||String(it.fotoPath||"").split("/")[0];
const simpan=item=>tx("readwrite",s=>{s.put(item)});
const ambil=id=>tx("readonly",s=>s.get(id));
const hapus=id=>tx("readwrite",s=>{s.delete(id)});
const daftar=()=>tx("readonly",s=>s.getAll()).then(a=>a.sort((x,y)=>x.dibuat-y.dibuat));
// Nota yang masih menunggu dikirim (tanpa error); dengan uid: hanya milik kasir itu. Dipakai untuk menahan logout.
const jumlah=uid=>daftar().then(a=>a.filter(it=>!it.error&&(!uid||milik(it)===uid)).length);
// Nota yang ditolak server: tetap tersimpan sampai diselesaikan pemilik (layar Nota).
const jumlahError=()=>daftar().then(a=>a.filter(it=>it.error).length);

// Jenis kegagalan: "putus" (jaringan/server sibuk: berhenti, coba lagi nanti), "jwt" (sesi kedaluwarsa:
// segarkan lalu ulang), "tolak" (server/storage menolak item ini: tandai error, lanjut ke item berikutnya).
function jenisGagal(e,status){const st=Number(status||(e&&e.status)||0),m=String((e&&e.message)||e||"");
  if(st===401||/jwt expired|invalid jwt|JWT/i.test(m)&&st!==0&&st<500)return "jwt";
  if(!st||st>=500||st===408||st===429)return "putus";
  return "tolak"}
class Gagal extends Error{constructor(e,status){super((e&&e.message)||String(e));this.jenis=jenisGagal(e,status)}}

async function unggahFoto(sb,it){
  const {error:e}=await sb.storage.from("bukti").upload(it.fotoPath,it.foto,{contentType:"image/jpeg",upsert:false});
  // Sudah terunggah pada percobaan sebelumnya = berhasil.
  // Status: error API storage membawa statusCode (dari isi jawaban) dan/atau status; error jaringan tidak punya keduanya.
  const st=Number(e&&(e.status||e.statusCode))||0;
  if(e&&st!==409&&!/already exists|duplicate/i.test(e.message||""))throw new Gagal(e,st)}
async function checkout(sb,it){let r=await sb.rpc("pos_checkout",{p:it.payload});
  // Satu-satunya alasan kode boleh diganti: server menolak kode ini (nota belum tersimpan).
  if(r.error&&/Kode bentrok/i.test(r.error.message||"")){it.payload.code=g.KasirKode.buat();await simpan(it);
    r=await sb.rpc("pos_checkout",{p:it.payload})}
  if(r.error)throw new Gagal(r.error,r.status);
  return r.data}
async function kirimSatu(sb,it){await unggahFoto(sb,it);return await checkout(sb,it)}

// opsi.uid: kasir yang login (item kasir lain dilewati). opsi.dulu: id item yang dikirim lebih dulu (nota baru Lunas);
// opsi.setelahDulu({hasil, ditolak}) dipanggil begitu item itu selesai dicoba, tanpa menunggu sisa antrean.
// Urutan lainnya: dibuat. Berhenti hanya di kegagalan jaringan; item yang ditolak ditandai error dan antrean lanjut.
// Hasil tambahan: hasil[id] = {hasil, kode} untuk nota terkirim, ditolak[id] = pesan.
async function jalankan(sb,opsi){let terkirim=0,berhenti=false,jwtDisegarkan=false;const hasil={},ditolak={};
  const antre=(await daftar()).filter(it=>!it.error&&(!opsi.uid||milik(it)===opsi.uid));
  if(opsi.dulu)antre.sort((a,b)=>(b.id===opsi.dulu)-(a.id===opsi.dulu));
  for(const it of antre){
    while(!berhenti){
      try{const h=await kirimSatu(sb,it);await hapus(it.id);hasil[it.id]={hasil:h,kode:it.payload.code};terkirim++;break}
      catch(e){const j=e instanceof Gagal?e.jenis:"putus";
        if(j==="jwt"&&!jwtDisegarkan){jwtDisegarkan=true;const r=await sb.auth.refreshSession().catch(x=>({error:x}));if(!r.error)continue}
        if(j==="tolak"){it.error=e.message;await simpan(it);ditolak[it.id]=it.error;break}
        berhenti=true}}
    if(it.id===opsi.dulu&&opsi.setelahDulu)opsi.setelahDulu({hasil,ditolak});
    if(hasil[it.id]||ditolak[it.id])continue;
    // Pengiriman pertama gagal: kirim berikutnya sebagai nota offline (masuk shift pada waktu nota dibuat).
    // Kecuali nota bervoucher: server menolak voucher TK- pada nota offline (tidak bisa dicek sudah terpakai),
    // jadi nota itu pasti ditolak bila diubah offline. Tetap dikirim sebagai nota online: berhasil bila shift
    // masih terbuka dan harga belum berubah; bila tidak, server menolaknya dan nota masuk daftar error.
    if(!it.payload.offline&&!it.payload.voucher_code){it.payload.offline=true;await simpan(it)}}
  return {terkirim,gagal:antre.length-terkirim,hasil,ditolak}}
// Satu pengiriman pada satu waktu (pemicu online/timer/Lunas bisa bersamaan).
let rantai=Promise.resolve();
function kirimSemua(sb,opsi){const j=rantai.then(()=>jalankan(sb,opsi||{}));rantai=j.catch(()=>{});return j}

g.Antrean={simpan,jumlah,jumlahError,ambil,hapus,daftar,milik,kirimSemua};
})(window);
