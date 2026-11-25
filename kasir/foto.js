/* Foto bukti: ambil dari kamera, kecilkan ke JPEG sisi terpanjang 960 px, target <= 40 KB. */
(function(g){
"use strict";
const SISI=960,TARGET=40*1024;
function ambil(){return new Promise((ok,gagal)=>{
  const i=document.createElement("input");i.type="file";i.accept="image/*";i.setAttribute("capture","environment");
  i.style.display="none";document.body.appendChild(i);
  const bersih=()=>setTimeout(()=>i.remove(),0);
  i.addEventListener("change",()=>{bersih();i.files&&i.files[0]?ok(i.files[0]):gagal(new Error("Tidak ada foto"))});
  i.addEventListener("cancel",()=>{bersih();gagal(new Error("Foto dibatalkan"))});
  i.click()})}
async function muat(file){
  if(g.createImageBitmap){try{return await g.createImageBitmap(file,{imageOrientation:"from-image"})}catch(e){}}
  return await new Promise((ok,gagal)=>{const u=URL.createObjectURL(file),im=new Image();
    im.onload=()=>{URL.revokeObjectURL(u);ok(im)};im.onerror=()=>{URL.revokeObjectURL(u);gagal(new Error("Foto tidak bisa dibaca"))};im.src=u})}
const jpeg=(c,q)=>new Promise((ok,gagal)=>c.toBlob(b=>b?ok(b):gagal(new Error("Foto gagal diproses")),"image/jpeg",q));
async function kecilkan(file){
  const im=await muat(file);const w0=im.width,h0=im.height;
  let skala=Math.min(1,SISI/Math.max(w0,h0)),hasil=null;
  // Kualitas 0.7 -> 0.4; bila masih > 40 KB, kecilkan ukuran (tetap <= 960 px).
  for(let putaran=0;putaran<4;putaran++){
    const c=document.createElement("canvas");c.width=Math.max(1,Math.round(w0*skala));c.height=Math.max(1,Math.round(h0*skala));
    const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.drawImage(im,0,0,c.width,c.height);
    for(const q of [0.7,0.6,0.5,0.4]){hasil=await jpeg(c,q);if(hasil.size<=TARGET){if(im.close)im.close();return hasil}}
    skala*=0.8}
  if(im.close)im.close();return hasil}
g.KasirFoto={ambil,kecilkan};
})(window);
