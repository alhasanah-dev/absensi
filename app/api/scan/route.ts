import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  // Wajib login sebagai petugas_absensi — sesi diambil dari cookie
  // device kiosk. RLS + pengecekan role di dalam RPC yang menegakkan
  // hak akses sebenarnya; ini cuma penolakan dini supaya pesannya jelas.
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
  const waktuRaw = body?.waktu;

  if (!kodeRaw || typeof kodeRaw !== "string") {
    return NextResponse.json(
      { ok: false, pesan: "Kode tidak valid." },
      { status: 400 }
    );
  }

  const kode = kodeRaw.trim();

  // `waktu` cuma dikirim saat me-replay scan yang sempat tersimpan di
  // antrian offline (lihat lib/sync.ts) — supaya jam yang tercatat di
  // database adalah jam SAAT KARTU DI-SCAN, bukan jam saat perangkat
  // berhasil tersambung internet lagi. Kalau tidak dikirim/tidak valid
  // (jalur online biasa), pakai jam server sekarang seperti biasa.
  const waktuValid = typeof waktuRaw === "string" && !Number.isNaN(Date.parse(waktuRaw));
  const sekarang = waktuValid ? new Date(waktuRaw).toISOString() : new Date().toISOString();

  if (kode.startsWith("SW-")) {
    return prosesScanSiswa(supabase, kode, sekarang);
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

type CatatHadirSiswaRow = {
  out_siswa_id: string;
  out_nama_lengkap: string;
  out_foto_url: string | null;
  aksi: "hadir" | "sudah_hadir" | "nonaktif";
};

async function prosesScanSiswa(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kode: string,
  sekarang: string
) {
  // Satu round-trip: RPC ini mencari siswa DAN mencatat presensinya
  // sekaligus (lihat supabase/schema-kiosk-satu-roundtrip-v20.sql di
  // repo yayasan-app).
  const { data: hasil, error: rpcError } = await supabase.rpc("catat_hadir_siswa", {
    p_kode_barcode: kode,
    p_waktu: sekarang,
  });

  if (rpcError) {
    if (rpcError.message?.includes("tidak ditemukan")) {
      return NextResponse.json(
        { ok: false, pesan: "Kode siswa tidak ditemukan." },
        { status: 404 }
      );
    }
    console.error("Gagal memanggil catat_hadir_siswa:", rpcError);
    return NextResponse.json(
      { ok: false, pesan: "Gagal menyimpan presensi." },
      { status: 500 }
    );
  }

  const r = ((hasil ?? []) as CatatHadirSiswaRow[])[0];

  if (!r) {
    return NextResponse.json(
      { ok: false, pesan: "Kode siswa tidak ditemukan." },
      { status: 404 }
    );
  }

  const nama = r.out_nama_lengkap;
  const fotoUrl = r.out_foto_url;

  if (r.aksi === "nonaktif") {
    return NextResponse.json(
      {
        ok: false,
        pesan: "Data siswa tidak aktif, tidak bisa presensi.",
        data: { tipe: "siswa", nama, foto_url: fotoUrl },
      },
      { status: 409 }
    );
  }

  if (r.aksi === "sudah_hadir") {
    return NextResponse.json(
      {
        ok: false,
        pesan: `${nama} sudah presensi hari ini.`,
        data: { tipe: "siswa", nama, foto_url: fotoUrl },
      },
      { status: 409 }
    );
  }

  return NextResponse.json({
    ok: true,
    pesan: "Presensi berhasil dicatat.",
    data: { tipe: "siswa", nama, foto_url: fotoUrl, event: "hadir", waktu: sekarang },
  });
}

// Baris yang dikembalikan RPC catat_hadir_pegawai — satu baris per unit
// yang diampu pemilik kode (guru satu unit = 1 baris, guru_multi = N
// baris, satu per unit yang diajar).
type CatatHadirPegawaiRow = {
  out_guru_id: string;
  out_unit_id: string;
  out_unit_nama: string;
  out_nama_lengkap: string;
  out_avatar_url: string | null;
  aksi: "masuk" | "masuk_koreksi" | "pulang" | "sudah_lengkap";
};

function labelAksi(aksi: CatatHadirPegawaiRow["aksi"]): string {
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
  // Satu round-trip juga di sini: RPC sekarang ikut mengembalikan
  // out_avatar_url, jadi SELECT terpisah ke `profiles` sebelum ini
  // (yang ada di versi lama) sudah tidak diperlukan lagi.
  const { data: hasil, error: rpcError } = await supabase.rpc(
    "catat_hadir_pegawai",
    { p_kode_barcode: kode, p_waktu: sekarang }
  );

  if (rpcError) {
    if (rpcError.message?.includes("tidak ditemukan")) {
      return NextResponse.json(
        { ok: false, pesan: "Kode pegawai tidak ditemukan." },
        { status: 404 }
      );
    }
    console.error("Gagal memanggil catat_hadir_pegawai:", rpcError);
    return NextResponse.json(
      { ok: false, pesan: "Gagal menyimpan presensi." },
      { status: 500 }
    );
  }

  const baris = (hasil ?? []) as CatatHadirPegawaiRow[];

  if (baris.length === 0) {
    return NextResponse.json(
      { ok: false, pesan: "Pegawai ini belum terdaftar pada unit manapun." },
      { status: 404 }
    );
  }

  const nama = baris[0].out_nama_lengkap;
  const fotoUrl = baris[0].out_avatar_url;

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
