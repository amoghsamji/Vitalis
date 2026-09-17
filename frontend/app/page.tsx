"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { buttonVariants } from "@/components/ui/Button";

export default function HomePage() {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading || !session) return;
    router.replace("/dashboard");
  }, [loading, session, router]);

  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center">
      <h1 className="text-4xl font-bold tracking-tight text-slate-900">
        Healthcare workflows, without the busywork
      </h1>
      <p className="max-w-xl text-slate-600">
        Vitalis connects doctors and patients for scheduling, lab intake, and
        automated follow-up &mdash; built on AWS-managed services end to end.
      </p>
      <div className="flex gap-3">
        <Link href="/signup" className={buttonVariants({ variant: "primary" })}>
          Get started
        </Link>
        <Link href="/login" className={buttonVariants({ variant: "secondary" })}>
          Sign in
        </Link>
      </div>
    </div>
  );
}
