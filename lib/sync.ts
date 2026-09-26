// Orkestrasi sinkron: mengirim ulang semua item di antrian offline
// (lib/offline-queue.ts) ke server, lalu menyegarkan cache roster
// (lib/roster-cache.ts). Dipanggil berkala, saat koneksi kembali
// (event 'online'), dan lewat tombol "Sinkron Sekarang" di KioskClient.
import { segarkanRoster } from "./roster-cache";
import { ambilAntrian, hapusDariAntrian, type ItemAntrian } from "./offline-queue";

async function kirimItemAntrian(item: ItemAntrian): Promise<boolean> {
  try {
    const res = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kode: item.kode, waktu: item.waktu }),
    });
    const json = await res.json().catch(() => null);
    // ok:true (berhasil dicatat) ATAU status 409 ("sudah presensi
    // hari ini" / "sudah lengkap") dua-duanya berarti SERVER sudah
    // tahu soal scan ini — aman dihapus dari antrian. Cuma error
    // jaringan atau 401/500 yang berarti "coba lagi nanti".
    return json?.ok === true || res.status === 409;
  } catch {
    return false;
  }
}

export async function sinkronSekarang(): Promise<{
  terkirim: number;
  sisa: number;
  rosterOk: boolean;
}> {
  const antrian = ambilAntrian();
  let terkirim = 0;
  for (const item of antrian) {
    // Berurutan (bukan Promise.all) supaya tidak membanjiri server
    // dengan puluhan request sekaligus kalau antrian sempat menumpuk
    // lama, dan supaya urutan waktu presensi tetap wajar.
    const berhasil = await kirimItemAntrian(item);
    if (berhasil) {
      hapusDariAntrian(item.id);
      terkirim++;
    }
  }
  const { ok: rosterOk } = await segarkanRoster();
  return { terkirim, sisa: ambilAntrian().length, rosterOk };
}
