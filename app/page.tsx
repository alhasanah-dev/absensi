import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import KioskClient from "./KioskClient";

export default async function KioskPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "petugas_absensi") {
    redirect("/login?error=akses_ditolak");
  }

  return <KioskClient petugasNama={profile.full_name ?? ""} />;
}
