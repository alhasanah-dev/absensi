// Antrian scan yang GAGAL disimpan langsung ke server (biasanya karena
// koneksi internet mati/lambat) — disimpan di localStorage supaya
// tidak hilang kalau halaman di-reload, lalu dicoba kirim ulang
// otomatis begitu koneksi kembali atau berkala (lihat lib/sync.ts),
// atau lewat tombol "Sinkron Sekarang" di layar kiosk.

const KUNCI_ANTRIAN = "absensi_antrian_v1";

export type ItemAntrian = {
  id: string; // id lokal acak, buat identifikasi saat menghapus dari antrian
  kode: string;
  waktu: string; // ISO timestamp SAAT KARTU DI-SCAN (bukan saat sinkron)
  tipe: "siswa" | "pegawai";
};

export function ambilAntrian(): ItemAntrian[] {
  try {
    const raw = localStorage.getItem(KUNCI_ANTRIAN);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function simpanAntrian(items: ItemAntrian[]) {
  try {
    localStorage.setItem(KUNCI_ANTRIAN, JSON.stringify(items));
  } catch {
    // localStorage penuh — kasus sangat langka untuk data sekecil ini;
    // item yang gagal masuk antrian ya sudah, tidak ada cara lain di sini.
  }
}

export function tambahKeAntrian(
  kode: string,
  waktu: string,
  tipe: "siswa" | "pegawai"
): ItemAntrian {
  const item: ItemAntrian = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kode,
    waktu,
    tipe,
  };
  simpanAntrian([...ambilAntrian(), item]);
  return item;
}

export function hapusDariAntrian(id: string) {
  simpanAntrian(ambilAntrian().filter((it) => it.id !== id));
}

export function jumlahAntrian(): number {
  return ambilAntrian().length;
}
