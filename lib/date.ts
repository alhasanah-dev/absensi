// Helper tanggal untuk zona waktu Asia/Jakarta (WIB), dipakai supaya
// "hari ini" pada tabel presensi/absensi_pegawai konsisten dengan
// jam dinding di sekolah, terlepas dari timezone server deploy.

export function getTanggalHariIniJakarta(): string {
  // en-CA menghasilkan format YYYY-MM-DD
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}
