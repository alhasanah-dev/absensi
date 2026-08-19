import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTanggalHariIniJakarta } from "@/lib/date";

const KODE_UNIQUE_VIOLATION = "23505";

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  // Wajib login sebagai petugas_absensi — sesi diambil dari cookie
  // device kiosk. RLS di database yang menegakkan hak akses
  // sebenarnya; ini cuma penolakan dini supaya pesannya jelas.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { ok: false, pesan: "Sesi perangkat berakhir, silakan login ulang." },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => null);
  const kodeRaw = body?.kode;

  if (!kodeRaw || typeof kodeRaw !== "string") {
    return NextResponse.json(
      { ok: false, pesan: "Kode tidak valid." },
      { status: 400 }
    );
  }

  const kode = kodeRaw.trim();
  const tanggal = getTanggalHariIniJakarta();
  const sekarang = new Date().toISOString();

  if (kode.startsWith("SW-")) {
    return prosesScanSiswa(supabase, kode, tanggal, sekarang);
  }

  if (kode.startsWith("PG-")) {
    return prosesScanPegawai(supabase, kode, tanggal, sekarang);
  }

  return NextResponse.json(
    {
      ok: false,
      pesan: 'Format kode tidak dikenali (harus diawali "SW-" atau "PG-").',
    },
    { status: 400 }
  );
}

async function prosesScanSiswa(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kode: string,
  tanggal: string,
  sekarang: string
) {
  const { data: siswa, error: siswaError } = await supabase
    .from("siswa")
    .select("id, nama_lengkap, foto_url, status")
    .eq("kode_barcode", kode)
    .maybeSingle();

  if (siswaError || !siswa) {
    return NextResponse.json(
      { ok: false, pesan: "Kode siswa tidak ditemukan." },
      { status: 404 }
    );
  }

  if (siswa.status !== "aktif") {
    return NextResponse.json(
      {
        ok: false,
        pesan: `Data siswa berstatus "${siswa.status}", tidak bisa presensi.`,
      },
      { status: 409 }
    );
  }

  const { error: insertError } = await supabase.from("presensi").insert({
    siswa_id: siswa.id,
    tanggal,
    status: "hadir",
    sumber: "kiosk",
    waktu_hadir: sekarang,
  });

  if (insertError) {
    if (insertError.code === KODE_UNIQUE_VIOLATION) {
      return NextResponse.json(
        {
          ok: false,
          pesan: "Siswa ini sudah presensi hari ini.",
          data: {
            tipe: "siswa",
            nama: siswa.nama_lengkap,
            foto_url: siswa.foto_url,
          },
        },
        { status: 409 }
      );
    }
    console.error("Gagal insert presensi:", insertError);
    return NextResponse.json(
      { ok: false, pesan: "Gagal menyimpan presensi." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    pesan: "Presensi berhasil dicatat.",
    data: {
      tipe: "siswa",
      nama: siswa.nama_lengkap,
      foto_url: siswa.foto_url,
      event: "hadir",
      waktu: sekarang,
    },
  });
}

async function prosesScanPegawai(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kode: string,
  tanggal: string,
  sekarang: string
) {
  const { data: guru, error: guruError } = await supabase
    .from("guru")
    .select("id, profiles:profile_id (full_name, avatar_url)")
    .eq("kode_barcode", kode)
    .maybeSingle();

  if (guruError || !guru) {
    return NextResponse.json(
      { ok: false, pesan: "Kode pegawai tidak ditemukan." },
      { status: 404 }
    );
  }

  const profil = Array.isArray(guru.profiles) ? guru.profiles[0] : guru.profiles;
  const nama = profil?.full_name ?? "(tanpa nama)";
  const fotoUrl = profil?.avatar_url ?? null;

  // Percobaan pertama: INSERT baris baru = jam masuk.
  const { error: insertError } = await supabase.from("absensi_pegawai").insert({
    guru_id: guru.id,
    tanggal,
    jam_masuk: sekarang,
    status: "hadir",
  });

  if (!insertError) {
    return NextResponse.json({
      ok: true,
      pesan: "Presensi masuk berhasil dicatat.",
      data: { tipe: "pegawai", nama, foto_url: fotoUrl, event: "masuk", waktu: sekarang },
    });
  }

  if (insertError.code !== KODE_UNIQUE_VIOLATION) {
    console.error("Gagal insert absensi_pegawai:", insertError);
    return NextResponse.json(
      { ok: false, pesan: "Gagal menyimpan presensi." },
      { status: 500 }
    );
  }

  // Sudah ada baris hari ini -> scan kedua = jam pulang, hanya jika
  // jam_pulang belum diisi.
  const { data: updated, error: updateError } = await supabase
    .from("absensi_pegawai")
    .update({ jam_pulang: sekarang })
    .eq("guru_id", guru.id)
    .eq("tanggal", tanggal)
    .is("jam_pulang", null)
    .select("id")
    .maybeSingle();

  if (updateError) {
    console.error("Gagal update jam_pulang:", updateError);
    return NextResponse.json(
      { ok: false, pesan: "Gagal menyimpan presensi pulang." },
      { status: 500 }
    );
  }

  if (!updated) {
    return NextResponse.json(
      {
        ok: false,
        pesan: "Pegawai ini sudah presensi masuk & pulang hari ini.",
        data: { tipe: "pegawai", nama, foto_url: fotoUrl },
      },
      { status: 409 }
    );
  }

  return NextResponse.json({
    ok: true,
    pesan: "Presensi pulang berhasil dicatat.",
    data: { tipe: "pegawai", nama, foto_url: fotoUrl, event: "pulang", waktu: sekarang },
  });
}
