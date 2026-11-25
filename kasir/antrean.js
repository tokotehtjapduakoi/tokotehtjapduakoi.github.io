/* Antrean nota offline: nota + foto disimpan di HP (IndexedDB "kasir", store "antrean"), dikirim saat ada sinyal.
   Item: {id, payload, foto: Blob, fotoPath, dibuat, error?}. payload = argumen pos_checkout, termasuk kode klaim. */
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

const simpan=item=>tx("readwrite",s=>{s.put(item)});
const jumlah=()=>tx("readonly",s=>s.count());
const ambil=id=>tx("readonly",s=>s.get(id));
const hapus=id=>tx("readwrite",s=>{s.delete(id)});
const daftar=()=>tx("readonly",s=>s.getAll()).then(a=>a.sort((x,y)=>x.dibuat-y.dibuat));

// Penolakan oleh server (raise exception / data tidak sah): mengirim ulang tidak akan berhasil.
// Selain itu (jaringan putus, jawaban terpotong, token kedaluwarsa, server sibuk) dicoba lagi nanti.
const ditolakServer=e=>/^(P0001|22|23)/.test(String((e&&e.code)||""));

async function kirimSatu(sb,it){
  const up=await sb.storage.from("bukti").upload(it.fotoPath,it.foto,{contentType:"image/jpeg",upsert:false});
  const e=up.error; // sudah terunggah pada percobaan sebelumnya = berhasil
  if(e&&String(e.statusCode||e.status)!=="409"&&!/already exists|duplicate/i.test(e.message||""))throw e;
  let r=await sb.rpc("pos_checkout",{p:it.payload});
  // Satu-satunya alasan kode boleh diganti: server menolak kode ini (nota belum tersimpan).
  if(r.error&&/Kode bentrok/i.test(r.error.message||"")){it.payload.code=g.KasirKode.buat();await simpan(it);
    r=await sb.rpc("pos_checkout",{p:it.payload})}
  if(r.error)throw r.error;
  return r.data}

// Urut dibuat. Berhenti di kesalahan jaringan; nota yang ditolak server ditandai error (tetap disimpan).
// Hasil tambahan: hasil[id] = {hasil, kode} untuk nota terkirim, ditolak[id] = pesan untuk nota yang ditolak.
async function jalankan(sb){let terkirim=0,berhenti=false;const hasil={},ditolak={};
  const antre=(await daftar()).filter(it=>!it.error);
  for(const it of antre){
    if(!berhenti){try{const h=await kirimSatu(sb,it);await hapus(it.id);hasil[it.id]={hasil:h,kode:it.payload.code};terkirim++;continue}
      catch(e){if(ditolakServer(e)){it.error=(e&&e.message)||String(e);await simpan(it);ditolak[it.id]=it.error;continue}
        berhenti=true}}
    // Pengiriman pertama gagal: kirim berikutnya sebagai nota offline (masuk shift pada waktu nota dibuat).
    // Kecuali nota bervoucher: voucher hanya sah online, jadi tetap dicoba sebagai nota online.
    if(!it.payload.offline&&!it.payload.voucher_code){it.payload.offline=true;await simpan(it)}}
  return {terkirim,gagal:antre.length-terkirim,hasil,ditolak}}
// Satu pengiriman pada satu waktu (pemicu online/timer/Lunas bisa bersamaan).
let rantai=Promise.resolve();
function kirimSemua(sb){const j=rantai.then(()=>jalankan(sb));rantai=j.catch(()=>{});return j}

g.Antrean={simpan,jumlah,ambil,hapus,daftar,kirimSemua};
})(window);
