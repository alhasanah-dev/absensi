"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeScannerState } from "html5-qrcode";

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
// Berapa lama kartu banner hasil scan ditampilkan di layar.
const DURASI_FEEDBACK_MS = 2200;
// Kode yang sama tidak diproses ulang selama jeda ini (mencegah satu
// kartu ter-scan berkali-kali selagi masih di depan kamera). Kode LAIN
// tetap bisa langsung diproses tanpa menunggu jeda ini — kamera TIDAK
// pernah dihentikan, mengikuti pola aplikasi scanner profesional
// (mis. scanner tiket/boarding pass) yang selalu live.
const COOLDOWN_PER_KODE_MS = 4000;

export default function KioskClient({ petugasNama }: { petugasNama: string }) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  // Mengunci hanya selagi ada request ke server yang sedang berjalan,
  // supaya tidak ada dua request bersamaan — bukan untuk menghentikan
  // kamera.
  const sedangMemprosesRef = useRef(false);
  const riwayatKodeRef = useRef<Map<string, number>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);

  const [status, setStatus] = useState<"menyiapkan" | "siap" | "error">("menyiapkan");
  const [errorKamera, setErrorKamera] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bunyikanNada = useCallback((sukses: boolean) => {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = sukses ? 880 : 220;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (sukses ? 0.18 : 0.32));
      osc.start();
      osc.stop(ctx.currentTime + (sukses ? 0.2 : 0.35));
      if (!sukses) {
        const osc2 = ctx.createOscillator();
        osc2.connect(gain);
        osc2.type = "sine";
        osc2.frequency.value = 160;
        osc2.start(ctx.currentTime + 0.18);
        osc2.stop(ctx.currentTime + 0.35);
      }
    } catch {
      // abaikan kalau audio tidak didukung
    }

    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(sukses ? 60 : [50, 60, 50]);
    }
  }, []);

  const prosesKode = useCallback(
    async (kodeMentah: string) => {
      const kode = kodeMentah.trim();
      if (!kode) return;

      const sekarangTs = Date.now();
      const terakhirDiproses = riwayatKodeRef.current.get(kode);
      if (terakhirDiproses && sekarangTs - terakhirDiproses < COOLDOWN_PER_KODE_MS) {
        // Kartu yang sama masih di depan kamera — abaikan, kamera tetap live.
        return;
      }
      if (sedangMemprosesRef.current) {
        // Ada request lain yang sedang berjalan; jangan tumpang tindih.
        return;
      }

      sedangMemprosesRef.current = true;
      riwayatKodeRef.current.set(kode, sekarangTs);

      try {
        const res = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kode }),
        });
        const json = await res.json().catch(() => null);

        if (json?.ok) {
          setFeedback({ status: "sukses", hasil: json.data, pesan: json.pesan });
          bunyikanNada(true);
        } else {
          setFeedback({
            status: "gagal",
            pesan: json?.pesan ?? "Kode tidak dikenali.",
          });
          bunyikanNada(false);
        }
      } catch (err) {
        console.error(err);
        setFeedback({ status: "gagal", pesan: "Koneksi bermasalah, coba lagi." });
        bunyikanNada(false);
      }

      sedangMemprosesRef.current = false;

      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = setTimeout(() => {
        setFeedback(null);
      }, DURASI_FEEDBACK_MS);
    },
    [bunyikanNada]
  );

  useEffect(() => {
    const scanner = new Html5Qrcode(READER_ELEMENT_ID, { verbose: false });
    scannerRef.current = scanner;
    let dibatalkan = false;

    // Kotak pemindai berbentuk kartu (landscape) meski frame kamera
    // portrait — meniru area scan aplikasi profesional yang tidak
    // memaksa kartu diputar 90 derajat.
    const qrboxFn = (viewfinderWidth: number, viewfinderHeight: number) => {
      const lebar = Math.round(Math.min(viewfinderWidth, viewfinderHeight) * 0.82);
      const tinggi = Math.round(lebar * 0.62);
      return { width: lebar, height: tinggi };
    };

    scanner
      .start(
        { facingMode: "environment" },
        {
          fps: 12,
          qrbox: qrboxFn,
          aspectRatio: 3 / 4,
          disableFlip: false,
        },
        (decodedText) => {
          void prosesKode(decodedText);
        },
        () => {
          // callback error per-frame (dipanggil terus saat tidak ada kode
          // terdeteksi di gambar) — sengaja diabaikan. Kamera TIDAK
          // pernah di-pause di sini, supaya video selalu live seperti
          // aplikasi scanner profesional.
        }
      )
      .then(() => {
        if (!dibatalkan) setStatus("siap");
      })
      .catch((err) => {
        console.error("Gagal mengaktifkan kamera:", err);
        if (!dibatalkan) {
          setStatus("error");
          setErrorKamera(
            "Tidak bisa mengakses kamera. Pastikan izin kamera diberikan dan halaman diakses lewat HTTPS."
          );
        }
      });

    return () => {
      dibatalkan = true;
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
      const s = scannerRef.current;
      if (s && s.getState && s.getState() !== Html5QrcodeScannerState.NOT_STARTED) {
        s.stop()
          .catch(() => {})
          .finally(() => {
            s.clear();
          });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prosesKode]);

  return (
    <main className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Header ala aplikasi kiosk profesional */}
      <header className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Kiosk Absensi</h1>
          {petugasNama && (
            <p className="text-slate-500 text-xs mt-0.5">Perangkat: {petugasNama}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span
            className={`h-2 w-2 rounded-full ${
              status === "siap"
                ? "bg-emerald-400 animate-pulse"
                : status === "error"
                ? "bg-red-500"
                : "bg-amber-400 animate-pulse"
            }`}
          />
          <span className="text-slate-400">
            {status === "siap" ? "Live" : status === "error" ? "Kamera Error" : "Menyiapkan..."}
          </span>
        </div>
      </header>

      {/* Area kamera portrait, memenuhi layar seperti aplikasi scan kartu profesional */}
      <div className="relative flex-1 w-full max-w-md mx-auto overflow-hidden bg-black">
        <div id={READER_ELEMENT_ID} className="absolute inset-0 [&>video]:!w-full [&>video]:!h-full [&>video]:!object-cover" />

        {status === "menyiapkan" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 text-slate-300 text-sm">
            <div className="h-8 w-8 rounded-full border-2 border-slate-600 border-t-emerald-400 animate-spin" />
            Menyalakan kamera...
          </div>
        )}

        {status === "error" && errorKamera && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/90 text-red-300 text-sm text-center p-6">
            {errorKamera}
          </div>
        )}

        {/* Panduan area scan + animasi garis pemindai, tampil terus selama
            kamera live (tidak disembunyikan saat memproses hasil, supaya
            terasa selalu aktif) */}
        {status === "siap" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative w-[82%] aspect-[1.6/1]">
              <div className="absolute inset-0 rounded-xl border-2 border-emerald-400/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
              <span className="absolute -left-0.5 -top-0.5 h-6 w-6 border-l-4 border-t-4 border-emerald-400 rounded-tl-lg" />
              <span className="absolute -right-0.5 -top-0.5 h-6 w-6 border-r-4 border-t-4 border-emerald-400 rounded-tr-lg" />
              <span className="absolute -left-0.5 -bottom-0.5 h-6 w-6 border-l-4 border-b-4 border-emerald-400 rounded-bl-lg" />
              <span className="absolute -right-0.5 -bottom-0.5 h-6 w-6 border-r-4 border-b-4 border-emerald-400 rounded-br-lg" />
              {!feedback && (
                <div className="absolute left-0 right-0 top-0 h-0.5 bg-emerald-400/90 shadow-[0_0_8px_2px_rgba(52,211,153,0.7)] animate-[scanline_2.1s_ease-in-out_infinite]" />
              )}
            </div>
          </div>
        )}

        <p className="pointer-events-none absolute bottom-4 left-0 right-0 text-center text-xs text-slate-300/90 px-6">
          Arahkan kartu QR/barcode siswa atau pegawai ke dalam bingkai
        </p>

        {/* Banner hasil scan — meluncur dari atas, TIDAK menghentikan
            video kamera di belakangnya */}
        <div
          className={`absolute left-0 right-0 top-0 px-4 pt-4 transition-all duration-300 ${
            feedback ? "translate-y-0 opacity-100" : "-translate-y-6 opacity-0 pointer-events-none"
          }`}
        >
          {feedback && (
            <div
              className={`rounded-2xl border shadow-xl backdrop-blur-md p-4 flex items-center gap-3 ${
                feedback.status === "sukses"
                  ? "bg-emerald-950/90 border-emerald-400/60"
                  : "bg-red-950/90 border-red-400/60"
              }`}
            >
              {feedback.status === "sukses" ? (
                <>
                  {feedback.hasil.foto_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={feedback.hasil.foto_url}
                      alt={feedback.hasil.nama}
                      className="w-14 h-14 rounded-full object-cover border-2 border-emerald-300 shrink-0"
                    />
                  ) : (
                    <div className="w-14 h-14 shrink-0 rounded-full bg-emerald-700 flex items-center justify-center text-xl font-bold">
                      {feedback.hasil.nama?.charAt(0) ?? "?"}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{feedback.hasil.nama}</div>
                    <div className="text-emerald-200 text-xs">{feedback.pesan}</div>
                    {feedback.hasil.event && (
                      <div className="text-[10px] uppercase tracking-wide text-emerald-300 mt-0.5">
                        {feedback.hasil.event === "pulang" ? "Jam Pulang" : "Jam Masuk / Hadir"}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="w-14 h-14 shrink-0 rounded-full bg-red-800 flex items-center justify-center text-2xl">
                    ✕
                  </div>
                  <div className="text-sm font-medium text-red-100">{feedback.pesan}</div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        @keyframes scanline {
          0% {
            top: 4%;
          }
          50% {
            top: 92%;
          }
          100% {
            top: 4%;
          }
        }
        #${READER_ELEMENT_ID} video {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
        }
      `}</style>
    </main>
  );
}
