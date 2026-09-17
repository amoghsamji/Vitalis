"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function PatientLayout({ children }: { children: React.ReactNode }) {
  const { session, loading, role } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else if (role === "doctor") router.replace("/dashboard");
  }, [loading, session, role, router]);

  if (loading || !session || role === "doctor") return null;
  return <>{children}</>;
}
