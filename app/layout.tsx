import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kiosk Absensi",
  description: "Kiosk absensi QR/barcode siswa & pegawai",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
