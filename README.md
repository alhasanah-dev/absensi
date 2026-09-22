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
3. **`schema-presensi-guru-multi-kartu-bersama-v14.sql`** (di repo
   "yayasan-app", bukan repo ini) — WAJIB sudah dijalankan juga.
   Migrasi ini memindahkan sumber kartu/QR pegawai dari
   `guru.kode_barcode` (satu kode per baris/unit) ke
   `profiles.kode_barcode` (satu kode per ORANG, lintas semua unit
   yang diampu — dipakai supaya guru multi-unit cukup 1 kartu), dan
   menambahkan function `catat_hadir_pegawai(kode_barcode, waktu)`
   yang dipakai endpoint scan pegawai di repo ini. Tanpa migrasi ini,
   scan kartu pegawai yang dicetak setelahnya akan gagal dengan pesan
   "Kode pegawai tidak ditemukan" karena kartunya berisi
   `profiles.kode_barcode`, bukan `guru.kode_barcode`.

Setelah itu:

- Buat akun login (Supabase Auth) untuk device kiosk, lalu di tabel
  `profiles` set `role = 'petugas_absensi'` untuk akun tersebut.
- Isi kolom `kode_barcode` pada data siswa (tabel `siswa`) dan pada
  data guru/staff (tabel **`profiles`**, sejak migrasi v14 di atas)
  yang mau bisa absen, contoh: `SW-00123` (siswa), `PG-00045`
  (pegawai) — inilah yang dicetak jadi kartu QR/barcode fisik.

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
4. Kode diawali `PG-` → dicocokkan ke `profiles.kode_barcode`, lalu
   dicatat lewat RPC `catat_hadir_pegawai`. Function ini otomatis
   mencari SEMUA unit yang diampu pemilik kode (guru satu unit = 1
   unit, guru_multi = beberapa unit sekaligus) dan mencatat untuk
   setiap unit: scan pertama hari itu di unit tsb = jam masuk, scan
   kedua = jam pulang, scan ketiga = ditolak (khusus unit yang sudah
   lengkap; unit lain yang belum discan tetap diproses).
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
- **`absensi_pegawai`: sejak migrasi v14, ditulis lewat RPC
  `catat_hadir_pegawai` (SECURITY DEFINER)**, bukan lagi
  INSERT/UPDATE langsung dari endpoint scan — function ini yang
  menegakkan `get_my_role() = 'petugas_absensi'` (raise exception
  kalau bukan) dan yang menangani fan-out ke banyak unit untuk guru
  multi-unit. Kebijakan insert/SELECT/UPDATE hari-berjalan dari v1b
  di atas tetap ada di database (aman, tidak konflik) tapi jalur
  scan pegawai di repo ini tidak lagi bergantung padanya.
- Role ini juga diberi **SELECT-only** (tanpa insert/update/delete)
  ke `siswa`, `guru`, dan `profiles`, untuk menampilkan nama + foto
  setelah scan berhasil (kebutuhan poin 6 di brief). Jalur pegawai
  sekarang membaca nama/foto dari **`profiles`** saja (lewat
  `profiles.kode_barcode`, kolom baru dari migrasi v14) — kebijakan
  SELECT pada `guru` dari v1b tidak lagi dipakai jalur ini tapi tetap
  dibiarkan ada untuk kompatibilitas/kegunaan lain.

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
