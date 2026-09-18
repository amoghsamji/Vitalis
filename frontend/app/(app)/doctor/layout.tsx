"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

// Session/loading is already guarded by app/(app)/layout.tsx — this only
// handles the role mismatch (a patient hitting a /doctor/* URL directly).
export default function DoctorLayout({ children }: { children: React.ReactNode }) {
  const { role, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && role === "patient") router.replace("/dashboard");
  }, [loading, role, router]);

  if (role === "patient") return null;
  return <>{children}</>;
}
