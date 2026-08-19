-- =========================================================
-- MIGRASI ABSENSI KIOSK v1b — Tabel & RLS untuk aplikasi kiosk
-- absensi QR/barcode ("yayasan-absensi")
--
-- WAJIB jalankan schema-absensi-kiosk-v1a-role.sql LEBIH DULU
-- (terpisah, sampai selesai/commit) sebelum menjalankan file ini.
--
-- Jalankan file ini SETELAH seluruh migrasi "yayasan-app" yang ada
-- (schema.sql, ..., schema-guru-multi-v4b-rls.sql, dst).
--
-- Ringkasan perubahan:
-- 1. Kolom `kode_barcode` (unik) pada `siswa` dan `guru` — nilai
--    kode QR/barcode fisik yang dicetak, diawali prefix "SW-" untuk
--    siswa dan "PG-" untuk pegawai (guru/staff). Dipisah dari
--    nis/nip supaya format & isinya bebas diatur (tidak harus sama
--    dengan NIS/NIP resmi).
-- 2. Tabel baru `absensi_pegawai` — presensi guru/pegawai, satu
--    baris per pegawai per hari, kolom jam_masuk diisi saat scan
--    pertama, jam_pulang diisi saat scan kedua.
-- 3. Kebijakan RLS baru untuk role `petugas_absensi`:
--    - Hanya boleh INSERT ke `presensi` (siswa) — scan kedua di
--      hari yang sama otomatis ditolak oleh UNIQUE(siswa_id, tanggal)
--      yang sudah ada di tabel `presensi` sejak schema.sql, TANPA
--      perlu izin SELECT sama sekali (aplikasi menangkap error
--      unique_violation dari Postgres).
--    - Untuk `absensi_pegawai`: INSERT (jam masuk) + UPDATE/SELECT
--      yang DIBATASI HANYA untuk baris hari ini (tanggal =
--      current_date). Ini perlu sedikit lebih dari "insert only"
--      murni karena scan kedua pegawai harus MENGUBAH baris yang
--      sudah ada (jam_pulang), bukan membuat baris baru — tapi
--      cakupannya tetap dikunci ke hari berjalan saja, tidak bisa
--      membaca/mengubah riwayat presensi hari-hari lain.
--    - SELECT terbatas pada `siswa`, `guru`, dan `profiles` — hanya
--      untuk menampilkan nama & foto setelah scan berhasil. Tidak
--      ada hak INSERT/UPDATE/DELETE ke tabel-tabel referensi ini.
-- 4. Tambahan kebijakan UPDATE untuk `guru` (sebelumnya tabel guru
--    di schema.sql hanya punya kebijakan select+insert), supaya
--    admin_unit/super_admin bisa mengisi kode_barcode pegawai lewat
--    menu Kelola Pengguna/Data Guru yang sudah ada.
-- =========================================================

-- ==== 1. KOLOM KODE BARCODE ====
alter table siswa add column if not exists kode_barcode text unique;
alter table guru add column if not exists kode_barcode text unique;

comment on column siswa.kode_barcode is 'Isi kartu QR/barcode siswa, contoh: SW-00123';
comment on column guru.kode_barcode is 'Isi kartu QR/barcode pegawai, contoh: PG-00045';

-- ==== 2. TABEL ABSENSI PEGAWAI (GURU/STAFF) ====
create table if not exists absensi_pegawai (
  id uuid primary key default gen_random_uuid(),
  guru_id uuid references guru(id) not null,
  tanggal date not null,
  jam_masuk timestamptz,
  jam_pulang timestamptz,
  status text default 'hadir' check (status in ('hadir', 'izin', 'sakit', 'alpha')),
  created_at timestamptz default now(),
  unique (guru_id, tanggal)
);

alter table absensi_pegawai enable row level security;

-- Catatan: setiap kebijakan didahului "drop policy if exists" supaya
-- file ini aman dijalankan ulang (idempotent) — mengikuti pola yang
-- sama dipakai di schema-guru-multi-v4b-rls.sql pada yayasan-app.

-- ==== 3. RLS: profiles — petugas_absensi butuh baca nama & foto
-- pemilik profil guru/staff yang di-scan ====
drop policy if exists "profiles_select_by_petugas_absensi" on profiles;
create policy "profiles_select_by_petugas_absensi" on profiles for select using (
  get_my_role() = 'petugas_absensi'
);

-- ==== 4. RLS: siswa & guru — petugas_absensi hanya boleh SELECT
-- (untuk lookup nama+foto berdasar kode_barcode), tidak ada hak
-- insert/update/delete ====
drop policy if exists "siswa_select_by_petugas_absensi" on siswa;
create policy "siswa_select_by_petugas_absensi" on siswa for select using (
  get_my_role() = 'petugas_absensi'
);

drop policy if exists "guru_select_by_petugas_absensi" on guru;
create policy "guru_select_by_petugas_absensi" on guru for select using (
  get_my_role() = 'petugas_absensi'
);

-- Kebijakan UPDATE guru belum ada sama sekali di schema.sql — perlu
-- ditambahkan supaya admin bisa mengisi kode_barcode via dashboard
-- yayasan-app (mengikuti pola persis siswa_update_by_unit).
-- Jika kamu SUDAH punya kebijakan update lain dengan nama berbeda
-- untuk tabel guru, itu tidak akan bentrok dengan ini (nama beda).
drop policy if exists "guru_update_by_unit" on guru;
create policy "guru_update_by_unit" on guru for update using (
  get_my_role() in ('super_admin', 'admin_unit') and (get_my_role() = 'super_admin' or unit_id = get_my_unit())
);

-- ==== 5. RLS: presensi (siswa) — INSERT SAJA untuk petugas_absensi.
-- Tidak ada kebijakan SELECT/UPDATE/DELETE untuk role ini: scan
-- kedua di hari yang sama ditolak lewat UNIQUE(siswa_id, tanggal)
-- yang sudah ada di schema.sql, ditangkap sebagai error di API. ====
drop policy if exists "presensi_insert_by_petugas_absensi" on presensi;
create policy "presensi_insert_by_petugas_absensi" on presensi for insert with check (
  get_my_role() = 'petugas_absensi'
);

-- ==== 6. RLS: absensi_pegawai ====
-- INSERT: mencatat jam masuk (scan pertama hari ini)
drop policy if exists "absensi_pegawai_insert_by_petugas" on absensi_pegawai;
create policy "absensi_pegawai_insert_by_petugas" on absensi_pegawai for insert with check (
  get_my_role() = 'petugas_absensi'
);

-- SELECT & UPDATE: dibatasi ketat hanya baris HARI INI, supaya scan
-- kedua bisa mengisi jam_pulang pada baris yang sudah dibuat scan
-- pertama. Tidak bisa dipakai membaca/mengubah riwayat hari lain.
drop policy if exists "absensi_pegawai_select_today_by_petugas" on absensi_pegawai;
create policy "absensi_pegawai_select_today_by_petugas" on absensi_pegawai for select using (
  get_my_role() = 'petugas_absensi' and tanggal = current_date
);

drop policy if exists "absensi_pegawai_update_today_by_petugas" on absensi_pegawai;
create policy "absensi_pegawai_update_today_by_petugas" on absensi_pegawai for update using (
  get_my_role() = 'petugas_absensi' and tanggal = current_date
) with check (
  get_my_role() = 'petugas_absensi' and tanggal = current_date
);

-- SELECT untuk pelaporan oleh admin/super_admin (mengikuti pola
-- presensi_select_by_unit di schema.sql)
drop policy if exists "absensi_pegawai_select_admin" on absensi_pegawai;
create policy "absensi_pegawai_select_admin" on absensi_pegawai for select using (
  get_my_role() = 'super_admin'
  or exists (select 1 from guru g where g.id = absensi_pegawai.guru_id and has_unit_access(g.unit_id))
);

-- =========================================================
-- CATATAN SETELAH MENJALANKAN FILE INI:
-- 1. Buat akun login untuk device kiosk lewat menu "Kelola Pengguna"
--    di yayasan-app (atau Supabase Auth langsung), lalu di tabel
--    `profiles` set kolom role = 'petugas_absensi' untuk akun
--    tersebut (unit_id boleh null, kebijakan di atas tidak
--    membatasi per unit untuk role ini).
-- 2. Isi kolom `kode_barcode` pada data siswa & guru yang sudah ada,
--    format bebas asal diawali "SW-" (siswa) / "PG-" (pegawai),
--    contoh: SW-00123, PG-00045. Ini yang dicetak jadi kartu
--    QR/barcode.
-- =========================================================
