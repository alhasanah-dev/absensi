import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTanggalHariIniJakarta } from "@/lib/date";

// Dipanggil oleh perangkat kiosk saat dibuka + berkala (lihat
// lib/roster-cache.ts) untuk mengisi cache lokal (localStorage) berisi
// data siswa & pegawai (kode_barcode -> nama/foto) plus daftar siswa
// yang sudah presensi hari ini — supaya proses SCAN tidak perlu lagi
// query ke Supabase untuk "siapa pemilik kode ini", cukup baca dari
// cache. Jaringan cuma dipakai untuk MENYIMPAN hasil scan.
export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { ok: false, pesan: "Sesi perangkat berakhir, silakan login ulang." },
      { status: 401 }
    );
  }

  const tanggal = getTanggalHariIniJakarta();

  const [siswaRes, pegawaiRes, presensiRes] = await Promise.all([
    supabase
      .from("siswa")
      .select("id, kode_barcode, nama_lengkap, foto_url")
      .eq("status", "aktif")
      .not("kode_barcode", "is", null),
    supabase
      .from("profiles")
      .select("id, kode_barcode, full_name, avatar_url")
      .in("role", ["guru", "guru_multi"])
      .not("kode_barcode", "is", null),
    supabase.from("presensi").select("siswa_id").eq("tanggal", tanggal),
  ]);

  if (siswaRes.error || pegawaiRes.error || presensiRes.error) {
    console.error(
      "Gagal mengambil data roster:",
      siswaRes.error,
      pegawaiRes.error,
      presensiRes.error
    );
    return NextResponse.json(
      { ok: false, pesan: "Gagal mengambil data roster." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    tanggal,
    siswa: (siswaRes.data ?? []).map((s) => ({
      id: s.id,
      kode: s.kode_barcode as string,
      nama: s.nama_lengkap,
      foto_url: s.foto_url,
    })),
    pegawai: (pegawaiRes.data ?? []).map((p) => ({
      id: p.id,
      kode: p.kode_barcode as string,
      nama: p.full_name,
      foto_url: p.avatar_url,
    })),
    siswaSudahHadir: (presensiRes.data ?? []).map((p) => p.siswa_id as string),
  });
}
