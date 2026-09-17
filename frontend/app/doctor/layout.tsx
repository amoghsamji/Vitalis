"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function DoctorLayout({ children }: { children: React.ReactNode }) {
  const { session, loading, role } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else if (role === "patient") router.replace("/dashboard");
  }, [loading, session, role, router]);

  if (loading || !session || role === "patient") return null;
  return <>{children}</>;
}
