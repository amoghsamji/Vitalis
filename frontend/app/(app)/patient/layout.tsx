"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

// Session/loading is already guarded by app/(app)/layout.tsx — this only
// handles the role mismatch (a doctor hitting a /patient/* URL directly).
export default function PatientLayout({ children }: { children: React.ReactNode }) {
  const { role, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && role === "doctor") router.replace("/dashboard");
  }, [loading, role, router]);

  if (role === "doctor") return null;
  return <>{children}</>;
}
