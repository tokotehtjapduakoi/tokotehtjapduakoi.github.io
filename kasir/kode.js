/* Kode klaim Kolam Koi: dibuat di HP, ditampilkan XXXXX-XXXXX, dibuat QR dan teks WA. */
(function(g){
"use strict";
const ALFABET="ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 karakter
const BATAS=248; // 31*8: byte >= 248 dibuang supaya sebaran sama rata
function buat(){let k="";
  while(k.length<10){const b=new Uint8Array(16);g.crypto.getRandomValues(b);
    for(const x of b){if(x<BATAS&&k.length<10)k+=ALFABET[x%31]}}
  return k}
const normal=s=>String(s??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const tampil=k=>{const n=normal(k);return n.slice(0,5)+"-"+n.slice(5)};
const urlKlaim=k=>((g.KASIR_CONFIG||{}).kolamUrl||"")+"?kode="+tampil(k);
function qrSvg(text){const q=g.qrcode(0,"M");q.addData(text);q.make();
  return q.createSvgTag({cellSize:4,margin:2,scalable:true,alt:"QR kode klaim"})}
const rp=n=>"Rp"+Math.round(Number(n)||0).toString().replace(/\B(?=(\d{3})+(?!\d))/g,".");
const waktu=d=>{const f=o=>new Intl.DateTimeFormat("id-ID",{timeZone:"Asia/Makassar",...o}).format(d);
  return f({day:"numeric",month:"short",year:"numeric"})+" "+f({hour:"2-digit",minute:"2-digit",hour12:false}).replace(".",":")};
// lines: [{qty, item, variant, price}] (price = harga satuan). tanggal: Date (bawaan: sekarang).
function teksWa({no,lines,total,method,kode,tanggal}){
  const baris=(lines||[]).map(l=>`${l.qty}× ${l.item} ${l.variant}  ${rp(l.price*l.qty)}`);
  return ["Toko Teh Tjap Dua Koi",`Nota ${no} · ${waktu(tanggal||new Date())}`,...baris,
    `Total ${rp(total)} (${method})`,"","Tarik kartu koi-mu di Kolam Koi:",urlKlaim(kode),
    `Kode: ${tampil(kode)} (berlaku 7 hari)`,"","Terima kasih, sampai ketemu lagi!"].join("\n")}
const linkWa=(phone62,teks)=>`https://wa.me/${phone62}?text=${encodeURIComponent(teks)}`;
const K={buat,tampil,normal,urlKlaim,qrSvg,teksWa,linkWa,rp};
g.KasirKode=K;
if(typeof module==="object"&&module.exports)module.exports=K;
})(typeof globalThis!=="undefined"?globalThis:window);
