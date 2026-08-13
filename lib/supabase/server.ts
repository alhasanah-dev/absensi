import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Client Supabase untuk dipakai di Server Components / Route Handlers.
// Sesi yang dipakai adalah sesi akun "petugas_absensi" yang login di
// device kiosk — semua query lewat client ini tunduk pada RLS role
// tersebut (lihat supabase/schema-absensi-kiosk-v1b.sql).
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Diabaikan jika dipanggil dari Server Component (bukan Route Handler)
          }
        },
      },
    }
  );
}
