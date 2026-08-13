-- =========================================================
-- MIGRASI ABSENSI KIOSK v1a — Tambah nilai role "petugas_absensi"
--
-- Dijalankan di project Supabase yang SAMA dengan "yayasan-app"
-- (aplikasi ini, "yayasan-absensi", memakai project Supabase yang
-- sama, hanya beda deploy/repo).
--
-- PENTING: Jalankan file ini SENDIRIAN (statement ini saja) di
-- Supabase Dashboard > SQL Editor, lalu klik "Run" dan tunggu sampai
-- selesai, SEBELUM menjalankan schema-absensi-kiosk-v1b.sql.
--
-- Alasan: PostgreSQL tidak mengizinkan nilai enum yang baru
-- ditambahkan dipakai dalam transaksi yang sama saat ia dibuat —
-- pola ini sama seperti schema-guru-multi-v4a-role.sql pada
-- project "yayasan-app".
-- =========================================================

alter type user_role add value if not exists 'petugas_absensi';
