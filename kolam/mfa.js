/* Verifikasi 2 langkah (TOTP) milik pemilik, dipakai bersama oleh Kasir (kasir/pemilik.js) dan Admin Kolam Koi (kolam/admin/admin.js).
   Hanya panggilan ke Supabase Auth; tampilan (QR, isian kode) dibuat tiap halaman sendiri.
   Alur: faktor() -> (daftar() bila belum ada) -> buktikan() -> halaman memuat ulang ringkasan dan memeriksa aal2. */
(function(){
"use strict";
const KoiMfa={
  /* id faktor TOTP yang sudah terbukti, atau null bila belum pernah mendaftar.
     Faktor yang dulu didaftarkan tetapi belum pernah dibuktikan dibuang supaya pendaftaran bisa diulang. */
  async faktor(sb){const {data,error}=await sb.auth.mfa.listFactors();if(error)throw error;
    const ada=(data.totp||[])[0];
    for(const f of (data.all||[]))if(f.factor_type==="totp"&&f.status==="unverified")await sb.auth.mfa.unenroll({factorId:f.id}).catch(()=>{});
    return ada?ada.id:null},
  /* Mulai mendaftar: {id, qr, secret} untuk ditampilkan. */
  async daftar(sb,nama){const {data,error}=await sb.auth.mfa.enroll({factorType:"totp",friendlyName:nama+" "+new Date().toISOString().slice(0,16)});
    if(error)throw error;return {id:data.id,qr:data.totp.qr_code,secret:data.totp.secret}},
  /* Buktikan kode 6 angka. daftar = hasil daftar() bila baru mendaftar; selain itu pakai faktorId yang sudah ada.
     Sesudahnya sesi diperbarui supaya token baru membawa aal2. */
  async buktikan(sb,{daftar,faktorId,kode}){let r;
    if(daftar){const c=await sb.auth.mfa.challenge({factorId:daftar.id});if(c.error)throw c.error;
      r=await sb.auth.mfa.verify({factorId:daftar.id,challengeId:c.data.id,code:kode})}
    else r=await sb.auth.mfa.challengeAndVerify({factorId:faktorId,code:kode});
    if(r.error)throw r.error;
    const f=await sb.auth.refreshSession();if(f.error)throw f.error},
  /* Kode salah atau kedaluwarsa? (untuk pesan yang ramah) */
  kodeSalah:e=>!KoiMfa.sesiHabis(e)&&/invalid|expired|code/i.test((e&&e.message)||""),
  /* Galat dari Supabase Auth/PostgREST karena sesi login sudah tidak berlaku (HP lama didiamkan)? */
  sesiHabis:e=>{if(!e)return false;
    if(e.name==="AuthSessionMissingError"||e.code==="PGRST301"||e.code==="refresh_token_not_found"||e.code==="session_not_found"||e.code==="bad_jwt")return true;
    if(e.name==="AuthApiError"&&e.status===401)return true;
    return /Auth session missing|AuthSessionMissing|JWT|Invalid Refresh Token|Refresh Token Not Found|session_not_found|session (has )?expired/i.test(e.message||"")}
};
KoiMfa.PESAN_HABIS="Sesi habis, silakan masuk lagi.";
window.KoiMfa=KoiMfa;
})();
