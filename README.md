# yayasan-absensi

Aplikasi kiosk absensi QR/barcode untuk siswa & guru/pegawai — **terpisah**
dari "yayasan-app" (repo & deploy sendiri), tapi memakai **project Supabase
yang sama**.

## 1. Setup database (Supabase)

Di project Supabase yang sama dengan "yayasan-app", jalankan di SQL Editor
**secara berurutan**:

1. `supabase/schema-absensi-kiosk-v1a-role.sql` — jalankan sendirian,
   tunggu selesai (menambah nilai enum `petugas_absensi`).
2. `supabase/schema-absensi-kiosk-v1b.sql` — tabel `absensi_pegawai`,
   kolom `kode_barcode` di `siswa`/`guru`, dan seluruh kebijakan RLS.

Setelah itu:

- Buat akun login (Supabase Auth) untuk device kiosk, lalu di tabel
  `profiles` set `role = 'petugas_absensi'` untuk akun tersebut.
- Isi kolom `kode_barcode` pada data siswa & guru yang mau bisa
  absen, contoh: `SW-00123` (siswa), `PG-00045` (pegawai) — inilah
  yang dicetak jadi kartu QR/barcode fisik.

## 2. Setup aplikasi

```bash
cp .env.local.example .env.local
# isi NEXT_PUBLIC_SUPABASE_URL & NEXT_PUBLIC_SUPABASE_ANON_KEY
# dengan nilai yang SAMA PERSIS seperti di yayasan-app

npm install
npm run dev
```

Buka `http://localhost:3000` di device kiosk (tablet/laptop dengan
kamera) lewat HTTPS saat produksi — akses kamera browser mensyaratkan
HTTPS (kecuali `localhost`). Deploy sebagai project Vercel baru,
terpisah dari "yayasan-app", dengan env vars yang sama.

## 3. Alur pakai

1. Device login sekali di `/login` pakai akun `petugas_absensi` —
   sesi tersimpan di cookie browser device.
2. Halaman `/` otomatis menyalakan kamera & mulai scan QR/barcode.
3. Kode diawali `SW-` → dicocokkan ke `siswa.kode_barcode`, insert ke
   `presensi`. Scan kedua di hari yang sama ditolak.
4. Kode diawali `PG-` → dicocokkan ke `guru.kode_barcode`. Scan
   pertama hari itu = jam masuk (insert baris baru ke
   `absensi_pegawai`); scan kedua = jam pulang (update baris yang
   sama); scan ketiga ditolak.
5. Nama + foto tampil ± 2 detik lalu kamera otomatis lanjut scan
   lagi; kode yang tidak ditemukan menampilkan pesan error.

## 4. Catatan tentang RLS `petugas_absensi`

Diminta "RLS hanya boleh insert" untuk role `petugas_absensi`. Ini
diikuti seketat mungkin, dengan satu penyesuaian yang perlu diketahui:

- **`presensi` (siswa): benar-benar insert-only**, tanpa kebijakan
  SELECT sama sekali. Penolakan scan kedua memanfaatkan
  `UNIQUE(siswa_id, tanggal)` yang sudah ada di tabel ini sejak
  `schema.sql` — API menangkap error `unique_violation` dari
  Postgres, bukan melakukan SELECT lebih dulu.
- **`absensi_pegawai`: insert + SELECT/UPDATE yang dikunci ke hari
  berjalan saja** (`tanggal = current_date`). Ini perlu sedikit lebih
  dari insert-only murni karena scan kedua pegawai harus **mengubah**
  baris jam masuk yang sudah ada (mengisi jam pulang), bukan membuat
  baris baru — dan Postgres RLS mensyaratkan kebijakan SELECT agar
  `UPDATE ... RETURNING` bisa mengonfirmasi baris mana yang berhasil
  diubah. Cakupannya tetap dikunci ketat: tidak bisa membaca atau
  mengubah riwayat presensi hari-hari sebelumnya.
- Role ini juga diberi **SELECT-only** (tanpa insert/update/delete)
  ke `siswa`, `guru`, dan `profiles`, semata untuk menampilkan nama +
  foto setelah scan berhasil (kebutuhan poin 6 di brief).

Kalau kebijakan ini ingin dibuat lebih ketat lagi (mis. SELECT di
`siswa`/`guru`/`profiles` dibatasi hanya kolom nama+foto lewat view),
tinggal ganti kebijakan `*_select_by_petugas_absensi` di
`schema-absensi-kiosk-v1b.sql` untuk mengarah ke view tersebut.

## 5. Akses dari device kiosk lewat jaringan lokal (dev)

`next.config.mjs` otomatis mendeteksi semua IP jaringan lokal
komputer kamu (lewat `os.networkInterfaces()`) setiap kali
`npm run dev` dijalankan, dan mendaftarkannya ke `allowedDevOrigins`
— fitur Next.js (≥14.2.30) yang menolak request cross-origin ke dev
server secara default. Jadi kalau ganti WiFi / dapat IP baru dari
DHCP, **tidak perlu edit manual** — cukup jalankan ulang
`npm run dev` (config dibaca ulang tiap kali proses start, tapi
tidak bisa hot-reload kalau IP berubah SAAT server sedang jalan).

**Catatan penting soal kamera:** `allowedDevOrigins` hanya
menyelesaikan blokir cross-origin Next.js — bukan syarat kamera
browser. Kamera tetap mensyaratkan "secure context" (HTTPS atau
`localhost`). Mengakses `http://192.168.x.x:3000` dari tablet kiosk
saat development **tidak akan bisa membuka kamera** di kebanyakan
browser. Untuk uji coba kamera dari device lain di LAN saat
development, opsinya:
- Pakai `next dev --experimental-https` — tapi sertifikat self-signed
  bawaan Next.js hanya untuk `localhost`, belum mendukung IP LAN
  sebagai Subject Alternative Name, jadi tablet kiosk akan tetap
  melihat peringatan sertifikat tidak dipercaya (bisa di-"Lanjutkan"
  manual khusus untuk testing).
- Atau tunnel sementara (mis. `ngrok`) yang memberi HTTPS publik ke
  dev server lokal.
- Di **produksi** (Vercel dsb.) ini otomatis bukan masalah karena
  domainnya sudah HTTPS asli.

## 6. Kenapa tidak pakai Service Role Key

Berbeda dari `lib/supabase/admin.ts` di "yayasan-app", aplikasi kiosk
ini sengaja **tidak** memakai Service Role Key sama sekali — semua
akses lewat anon key + sesi login `petugas_absensi`, supaya device
yang bisa dicuri/hilang di lapangan tetap dibatasi RLS, bukan
punya akses penuh bypass RLS.
