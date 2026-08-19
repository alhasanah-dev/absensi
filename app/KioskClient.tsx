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
// pernah dihentikan/dipause, mengikuti pola aplikasi scanner profesional
// (mis. scanner tiket/boarding pass) yang video-nya selalu live.
const COOLDOWN_PER_KODE_MS = 4000;

export default function KioskClient({ petugasNama }: { petugasNama: string }) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  // Mengunci hanya selagi ada request ke server yang sedang berjalan,
  // supaya tidak ada dua request bersamaan — bukan untuk menghentikan
  // kamera.
  const sedangMemprosesRef = useRef(false);
  const riwayatKodeRef = useRef<Map<string, number>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [siap, setSiap] = useState(false);
  const [errorKamera, setErrorKamera] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

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

    scanner
      .start(
        { facingMode: "environment" },
        {
          fps: 12,
          // SENGAJA tidak diisi "qrbox": kalau diisi, html5-qrcode
          // menggambar overlay/kotak pemindainya SENDIRI di atas video
          // (kotak defaultnya landscape & ukurannya dihitung ulang dari
          // dimensi container saat start(), yang gampang meleset dari
          // bingkai kartu portrait yang kita gambar sendiri di bawah —
          // itulah penyebab bug "animasi scan keluar dari frame kamera").
          // Dengan qrbox dikosongkan, seluruh frame video dipakai untuk
          // pemindaian, dan bingkai kartu di layar murni dekorasi CSS
          // kita sendiri, jadi selalu presisi & tidak pernah bentrok.
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
    <main className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6">
      <h1 className="text-2xl font-semibold mb-1">Kiosk Absensi</h1>
      <p className="text-slate-400 mb-1 text-sm">
        Arahkan kartu QR/barcode siswa atau pegawai ke kamera
      </p>
      {petugasNama && (
        <p className="text-slate-500 mb-6 text-xs">Perangkat: {petugasNama}</p>
      )}

      {/* Kotak kamera: model kartu POTRAIT (lebih tinggi dari lebar),
          menggantikan kotak persegi (aspect-square) sebelumnya. Semua
          overlay/animasi di bawah berada DI DALAM div ini yang punya
          overflow-hidden, jadi tidak akan pernah keluar dari bingkai. */}
      <div className="relative w-full max-w-xs aspect-[3/4] rounded-2xl overflow-hidden border-4 border-slate-700 bg-black">
        <div
          id={READER_ELEMENT_ID}
          className="absolute inset-0 [&_video]:!w-full [&_video]:!h-full [&_video]:!object-cover"
        />

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

        {/* Panduan area scan berbentuk kartu potrait + animasi garis
            pemindai — 100% dekorasi CSS kita sendiri (bukan bawaan
            html5-qrcode), dibatasi ketat di dalam kotak kamera di atas. */}
        {siap && !errorKamera && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <div className="relative h-full w-[78%] max-w-[220px]">
              <div className="absolute inset-0 rounded-xl border-2 border-emerald-400/70" />
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

      <style jsx global>{`
        @keyframes scanline {
          0% {
            top: 2%;
          }
          50% {
            top: 96%;
          }
          100% {
            top: 2%;
          }
        }
      `}</style>
    </main>
  );
}
