// Cache roster (data siswa & pegawai) + status "sudah presensi hari
// ini" untuk siswa, disimpan di localStorage supaya proses SCAN bisa
// langsung cari datanya di lokal TANPA menunggu jaringan ke Supabase —
// jaringan cuma dipakai untuk MENYIMPAN hasil scan, bukan untuk
// mencari siapa pemilik kodenya.
//
// Pegawai SENGAJA TIDAK diberi status "sudah hadir hari ini" di sini.
// Aturannya (guru yang mengajar di banyak unit sekaligus — kartu
// bersama, per-unit jam masuk/pulang) sudah cukup rumit dan sudah
// ditegakkan lewat function database `catat_hadir_pegawai`;
// menduplikasi aturan itu ke JavaScript berisiko dua tempat itu tidak
// sinkron kalau aturannya berubah nanti. Jadi pegawai tetap harus
// online untuk KONFIRMASI akhirnya (lihat KioskClient.tsx) — cache ini
// cuma dipakai untuk tampilkan nama+foto secara instan & sebagai
// jaring pengaman kalau kebetulan koneksi putus pas discan.
import { ambilAntrian } from "./offline-queue";

const KUNCI_ROSTER = "absensi_roster_v1";

export type OrangRoster = { id: string; nama: string; foto_url: string | null };

export type DataRoster = {
  tanggal: string; // YYYY-MM-DD (WIB) — tanggal terakhir kali roster disegarkan
  diperbarui: string; // ISO timestamp
  siswa: Record<string, OrangRoster>; // key = kode_barcode
  pegawai: Record<string, OrangRoster>; // key = kode_barcode
  siswaSudahHadir: Record<string, true>; // key = siswa id
};

export function simpanRoster(data: DataRoster) {
  try {
    localStorage.setItem(KUNCI_ROSTER, JSON.stringify(data));
  } catch {
    // localStorage penuh/tidak tersedia — cache jadi tidak aktif, tapi
    // aplikasi tetap bisa jalan lewat jalur online biasa (lihat
    // KioskClient.tsx: kalau tidak ada di cache, scan siswa akan minta
    // coba Sinkron dulu, bukan crash).
  }
}

export function ambilRoster(): DataRoster | null {
  try {
    const raw = localStorage.getItem(KUNCI_ROSTER);
    if (!raw) return null;
    return JSON.parse(raw) as DataRoster;
  } catch {
    return null;
  }
}

// Dipanggil segera setelah sebuah scan siswa BERHASIL (baik langsung
// terkirim maupun lewat antrian offline) supaya scan BERIKUTNYA untuk
// siswa yang sama, sebelum sempat sinkron ulang, langsung tahu bahwa
// orang itu sudah presensi — tanpa ini, kartu yang sama bisa ke-scan
// dua kali sebelum roster sempat disegarkan dari server.
export function tandaiSiswaSudahHadirLokal(siswaId: string) {
  const data = ambilRoster();
  if (!data) return;
  data.siswaSudahHadir[siswaId] = true;
  simpanRoster(data);
}

type RosterApiResponse = {
  ok: boolean;
  pesan?: string;
  tanggal: string;
  siswa: Array<{ id: string; kode: string; nama: string; foto_url: string | null }>;
  pegawai: Array<{ id: string; kode: string; nama: string; foto_url: string | null }>;
  siswaSudahHadir: string[];
};

export async function segarkanRoster(): Promise<{ ok: boolean; pesan?: string }> {
  try {
    const res = await fetch("/api/roster", { cache: "no-store" });
    const json = (await res.json().catch(() => null)) as RosterApiResponse | null;
    if (!res.ok || !json?.ok) {
      return { ok: false, pesan: json?.pesan ?? "Gagal mengambil data roster." };
    }

    // Merge, bukan timpa mentah-mentah: siswa yang baru saja discan
    // secara lokal tapi belum sempat tersinkron ke server harus tetap
    // dianggap "sudah hadir" di sini, walau server (yang belum
    // menerima scan itu) belum tahu — kalau ditimpa mentah-mentah,
    // siswa itu berisiko ke-scan dua kali.
    const lama = ambilRoster();
    const antrianPendingSiswa = ambilAntrian().filter((it) => it.tipe === "siswa");

    const siswaSudahHadir: Record<string, true> = {};
    for (const id of json.siswaSudahHadir) siswaSudahHadir[id] = true;
    if (lama && lama.tanggal === json.tanggal) {
      for (const id of Object.keys(lama.siswaSudahHadir)) siswaSudahHadir[id] = true;
    }
    for (const item of antrianPendingSiswa) {
      const orang = json.siswa.find((s) => s.kode === item.kode);
      if (orang) siswaSudahHadir[orang.id] = true;
    }

    const siswa: Record<string, OrangRoster> = {};
    for (const s of json.siswa) siswa[s.kode] = { id: s.id, nama: s.nama, foto_url: s.foto_url };

    const pegawai: Record<string, OrangRoster> = {};
    for (const p of json.pegawai) pegawai[p.kode] = { id: p.id, nama: p.nama, foto_url: p.foto_url };

    simpanRoster({
      tanggal: json.tanggal,
      diperbarui: new Date().toISOString(),
      siswa,
      pegawai,
      siswaSudahHadir,
    });
    return { ok: true };
  } catch {
    return { ok: false, pesan: "Tidak bisa terhubung ke server." };
  }
}
