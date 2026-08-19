"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError("Email atau password salah.");
      setLoading(false);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-900 p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-slate-800 rounded-xl p-6 space-y-4 shadow-xl"
      >
        <div>
          <h1 className="text-xl font-semibold text-white">
            Login Perangkat Absensi
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Masuk dengan akun petugas absensi untuk mengaktifkan kiosk ini.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-sm text-slate-300" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md bg-slate-700 text-white px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-slate-300" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md bg-slate-700 text-white px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white py-2 font-medium transition-colors"
        >
          {loading ? "Memproses..." : "Masuk"}
        </button>
      </form>
    </main>
  );
}
