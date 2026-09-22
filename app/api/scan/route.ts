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
    return prosesScanPegawai(supabase, kode, sekarang);
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

// Baris yang dikembalikan RPC catat_hadir_pegawai — satu baris per unit
// yang diampu pemilik kode (guru satu unit = 1 baris, guru_multi = N
// baris, satu per unit yang diajar).
type CatatHadirRow = {
  out_guru_id: string;
  out_unit_id: string;
  out_unit_nama: string;
  out_nama_lengkap: string;
  aksi: "masuk" | "masuk_koreksi" | "pulang" | "sudah_lengkap";
};

function labelAksi(aksi: CatatHadirRow["aksi"]): string {
  switch (aksi) {
    case "masuk":
      return "Masuk";
    case "masuk_koreksi":
      return "Masuk (koreksi)";
    case "pulang":
      return "Pulang";
    case "sudah_lengkap":
      return "Sudah Lengkap";
  }
}

async function prosesScanPegawai(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kode: string,
  sekarang: string
) {
  // PENTING: sejak migrasi "guru multi kartu bersama" di yayasan-app
  // (schema-presensi-guru-multi-kartu-bersama-v14.sql), kartu/QR
  // pegawai dibuat dari `profiles.kode_barcode` — SATU kode per ORANG,
  // dipakai lintas semua unit yang diampu — BUKAN `guru.kode_barcode`
  // lagi (itu satu kode per BARIS/unit, sumber bug "Kode pegawai tidak
  // ditemukan": kartu baru yang dicetak dari profiles.kode_barcode
  // tidak akan pernah cocok saat dicari di kolom guru.kode_barcode).
  // Lookup nama+foto lewat `profiles` di sini supaya konsisten dengan
  // sumber kartu yang sekarang berlaku.
  const { data: profil, error: profilError } = await supabase
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("kode_barcode", kode)
    .maybeSingle();

  if (profilError || !profil) {
    return NextResponse.json(
      { ok: false, pesan: "Kode pegawai tidak ditemukan." },
      { status: 404 }
    );
  }

  const nama = profil.full_name ?? "(tanpa nama)";
  const fotoUrl = profil.avatar_url ?? null;

  // catat_hadir_pegawai (SECURITY DEFINER RPC) mencari SEMUA baris
  // `guru` (semua unit) milik profil yang kodenya di-scan, lalu
  // mengisi/mengupdate absensi_pegawai untuk SETIAP unit tsb dalam satu
  // transaksi — guru satu unit biasa tetap bekerja normal karena
  // tinggal 1 baris yang diproses. Ini juga yang menegakkan otorisasi
  // role petugas_absensi (raise exception kalau bukan role tsb).
  const { data: hasil, error: rpcError } = await supabase.rpc(
    "catat_hadir_pegawai",
    { p_kode_barcode: kode, p_waktu: sekarang }
  );

  if (rpcError) {
    console.error("Gagal memanggil catat_hadir_pegawai:", rpcError);
    return NextResponse.json(
      { ok: false, pesan: "Gagal menyimpan presensi." },
      { status: 500 }
    );
  }

  const baris = (hasil ?? []) as CatatHadirRow[];

  if (baris.length === 0) {
    // Profil ditemukan tapi belum ada baris `guru` di unit manapun.
    return NextResponse.json(
      { ok: false, pesan: "Pegawai ini belum terdaftar pada unit manapun." },
      { status: 404 }
    );
  }

  if (baris.every((b) => b.aksi === "sudah_lengkap")) {
    return NextResponse.json(
      {
        ok: false,
        pesan:
          baris.length > 1
            ? `Pegawai ini sudah presensi masuk & pulang hari ini di semua unit (${baris
                .map((b) => b.out_unit_nama)
                .join(", ")}).`
            : "Pegawai ini sudah presensi masuk & pulang hari ini.",
        data: { tipe: "pegawai", nama, foto_url: fotoUrl },
      },
      { status: 409 }
    );
  }

  const event: "masuk" | "pulang" = baris.some(
    (b) => b.aksi === "masuk" || b.aksi === "masuk_koreksi"
  )
    ? "masuk"
    : "pulang";

  const pesan =
    baris.length > 1
      ? `Presensi tercatat: ${baris
          .map((b) => `${b.out_unit_nama} (${labelAksi(b.aksi)})`)
          .join(", ")}.`
      : event === "masuk"
      ? "Presensi masuk berhasil dicatat."
      : "Presensi pulang berhasil dicatat.";

  return NextResponse.json({
    ok: true,
    pesan,
    data: { tipe: "pegawai", nama, foto_url: fotoUrl, event, waktu: sekarang },
  });
}
