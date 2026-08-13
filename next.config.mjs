import os from "os";

// ==== Deteksi otomatis semua IP jaringan lokal komputer ====
// Next.js (sejak 14.2.30, lihat catatan di README) memblokir request
// cross-origin ke dev server secara default — termasuk saat kiosk
// (tablet/HP) mengakses lewat IP LAN komputer ("Network:
// http://192.168.x.x:3000" yang muncul saat `next dev` jalan),
// bukan lewat "localhost".
//
// Daripada menuliskan IP itu manual di allowedDevOrigins (yang harus
// diedit ulang tiap kali ganti WiFi / dapat IP baru dari DHCP),
// fungsi ini membaca semua IP lokal langsung dari OS setiap kali
// `npm run dev` dijalankan lewat os.networkInterfaces() — jadi
// SELALU IKUT IP TERBARU, tidak perlu diedit manual lagi.
//
// CATATAN: ini hanya dibaca sekali saat proses `next dev` START.
// Kalau IP berubah SAAT dev server sedang berjalan (mis. pindah
// WiFi di tengah jalan), restart `npm run dev` supaya daftar IP
// disegarkan — Next.js tidak bisa hot-reload konfigurasi ini.
function getLocalNetworkIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      const isIPv4 = iface.family === "IPv4" || iface.family === 4;
      // Lewati alamat internal (127.0.0.1) dan link-local APIPA
      // (169.254.x.x, biasanya muncul saat adapter tidak dapat IP
      // dari DHCP) — keduanya tidak berguna untuk diakses dari
      // device lain di jaringan yang sama.
      const isUseless =
        iface.internal || iface.address.startsWith("169.254.");

      if (isIPv4 && !isUseless) {
        ips.push(iface.address);
      }
    }
  }

  return ips;
}

const localNetworkIPs = getLocalNetworkIPs();

if (process.env.NODE_ENV !== "production" && localNetworkIPs.length > 0) {
  console.log(
    `📡 Kiosk bisa diakses dari perangkat lain di jaringan yang sama lewat:\n` +
      localNetworkIPs.map((ip) => `   http://${ip}:3000`).join("\n") +
      "\n"
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
    ],
  },

  // Izinkan semua IP lokal yang barusan dideteksi mengakses dev
  // server (hot reload, dsb). Hanya berpengaruh saat `next dev`;
  // tidak berdampak apa pun ke `next build`/`next start` produksi.
  allowedDevOrigins: localNetworkIPs,
};

export default nextConfig;
