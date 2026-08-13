"use client";

import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

type HasilScan = {
  tipe: "siswa" | "pegawai";
  nama: string;
  foto_url?: string | null;
  event?: "hadir" | "masuk" | "pulang";
};

type Feedback =
  | { status: "sukses"; hasil: HasilScan; pesan: string }
  | { status: "gagal"; pesan: string };

const READER_ELEMENT_ID = "kiosk-reader";
const DURASI_FEEDBACK_MS = 2000;

export default function KioskClient({ petugasNama }: { petugasNama: string }) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isProcessingRef = useRef(false);

  const [siap, setSiap] = useState(false);
  const [errorKamera, setErrorKamera] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    const scanner = new Html5Qrcode(READER_ELEMENT_ID, { verbose: false });
    scannerRef.current = scanner;
    let dibatalkan = false;

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 260, height: 260 } },
        (decodedText) => {
          void prosesKode(decodedText);
        },
        () => {
          // callback error per-frame (dipanggil terus saat tidak ada kode
          // terdeteksi di gambar) — sengaja diabaikan.
        }
      )
      .then(() => {
        if (!dibatalkan) setSiap(true);
      })
      .catch((err) => {
        console.error("Gagal mengaktifkan kamera:", err);
        if (!dibatalkan) {
          setErrorKamera(
            "Tidak bisa mengakses kamera. Pastikan izin kamera diberikan dan halaman diakses lewat HTTPS."
          );
        }
      });

    return () => {
      dibatalkan = true;
      scanner
        .stop()
        .catch(() => {})
        .finally(() => {
          scanner.clear();
        });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function prosesKode(kode: string) {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    try {
      await scannerRef.current?.pause(true);
    } catch {
      // kamera mungkin belum sepenuhnya siap; lanjutkan saja
    }

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kode }),
      });
      const json = await res.json();

      if (json.ok) {
        setFeedback({ status: "sukses", hasil: json.data, pesan: json.pesan });
      } else {
        setFeedback({
          status: "gagal",
          pesan: json.pesan ?? "Kode tidak dikenali.",
        });
      }
    } catch (err) {
      console.error(err);
      setFeedback({ status: "gagal", pesan: "Koneksi bermasalah, coba lagi." });
    }

    setTimeout(async () => {
      setFeedback(null);
      isProcessingRef.current = false;
      try {
        await scannerRef.current?.resume();
      } catch {
        // kamera mungkin sudah berhenti (mis. komponen unmount); abaikan
      }
    }, DURASI_FEEDBACK_MS);
  }

  return (
    <main className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6">
      <h1 className="text-2xl font-semibold mb-1">Kiosk Absensi</h1>
      <p className="text-slate-400 mb-1 text-sm">
        Arahkan kartu QR/barcode siswa atau pegawai ke kamera
      </p>
      {petugasNama && (
        <p className="text-slate-500 mb-6 text-xs">Perangkat: {petugasNama}</p>
      )}

      <div className="relative w-full max-w-md aspect-square rounded-2xl overflow-hidden border-4 border-slate-700 bg-black">
        <div id={READER_ELEMENT_ID} className="w-full h-full" />

        {!siap && !errorKamera && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-slate-300 text-sm">
            Menyalakan kamera...
          </div>
        )}

        {errorKamera && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-red-300 text-sm text-center p-6">
            {errorKamera}
          </div>
        )}

        {feedback && (
          <div
            className={`absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center ${
              feedback.status === "sukses" ? "bg-emerald-900/90" : "bg-red-900/90"
            }`}
          >
            {feedback.status === "sukses" ? (
              <>
                {feedback.hasil.foto_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={feedback.hasil.foto_url}
                    alt={feedback.hasil.nama}
                    className="w-24 h-24 rounded-full object-cover border-4 border-emerald-300"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-emerald-700 flex items-center justify-center text-3xl font-bold">
                    {feedback.hasil.nama?.charAt(0) ?? "?"}
                  </div>
                )}
                <div className="text-xl font-semibold">{feedback.hasil.nama}</div>
                <div className="text-emerald-200 text-sm">{feedback.pesan}</div>
                {feedback.hasil.event && (
                  <div className="text-xs uppercase tracking-wide text-emerald-300">
                    {feedback.hasil.event === "pulang" ? "Jam Pulang" : "Jam Masuk / Hadir"}
                  </div>
                )}
              </>
            ) : (
              <div className="text-lg font-medium text-red-200">{feedback.pesan}</div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
