"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Stethoscope } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { buttonVariants } from "@/components/ui/Button";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading || !session) return;
    // Only auto-redirect to dashboard from auth gates and root landing page
    if (pathname === "/" || pathname === "/login" || pathname === "/signup") {
      router.replace("/dashboard");
    }
  }, [loading, session, router, pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
      {/* Top Clinical Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-[2px] border border-primary/40 bg-primary/10 text-primary">
                <Stethoscope className="h-4 w-4" />
              </span>
              <span className="font-serif text-xl font-semibold tracking-tight text-foreground">
                Vitalis
              </span>
              <span className="hidden sm:inline-block rounded-[2px] border border-primary/40 bg-primary/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-primary font-medium">
                Clinical Ledger
              </span>
            </Link>

            <nav className="hidden items-center gap-6 md:flex">
              <Link
                href="/"
                className="font-mono text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
              >
                Overview
              </Link>
              <Link
                href="/privacy"
                className="font-mono text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
              >
                Privacy
              </Link>
              <Link
                href="/terms"
                className="font-mono text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
              >
                Terms
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 border-r border-border pr-4">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-700 animate-status-pulse" />
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                SYSTEM OPERATIONAL
              </span>
            </div>

            {!loading && !session ? (
              <div className="flex items-center gap-2">
                <Link
                  href="/login"
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  className={buttonVariants({ variant: "default", size: "sm" })}
                >
                  Register
                </Link>
              </div>
            ) : !loading && session ? (
              <Link
                href="/dashboard"
                className={buttonVariants({ variant: "default", size: "sm" })}
              >
                Portal Dashboard
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">{children}</main>

      {/* Editorial Document Footer */}
      <footer className="border-t border-border bg-card/60 text-foreground">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-4">
            <div className="flex flex-col gap-3 sm:col-span-2">
              <div className="flex items-center gap-2">
                <span className="font-serif text-base font-semibold tracking-tight text-foreground">
                  Vitalis Health Systems
                </span>
                <span className="rounded-[2px] border border-border px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  REF-2025
                </span>
              </div>
              <p className="max-w-md font-serif text-xs leading-relaxed text-muted-foreground">
                Architected on AWS-native services for clinical healthcare operations. Standardized coordination for patient scheduling, diagnostic PDF report intake, and auditable care follow-up protocols.
              </p>
              <div className="mt-2 flex items-center gap-2 font-mono text-[10px] tracking-wider text-muted-foreground">
                <span className="inline-block h-1.5 w-1.5 rounded-none bg-accent" />
                <span>SYS.ENV: ACTIVE // ENCRYPTION: AES-256 // REGION: US-EAST-1</span>
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              <h3 className="font-mono text-[10px] uppercase tracking-widest text-foreground">Navigation</h3>
              <nav className="flex flex-col gap-1.5 font-serif text-xs text-muted-foreground">
                <Link href="/" className="hover:text-foreground">Clinical Overview</Link>
                <Link href="/login" className="hover:text-foreground">Provider Portal</Link>
                <Link href="/signup" className="hover:text-foreground">Patient Registration</Link>
                <Link href="/login" className="hover:text-foreground">Appointment Management</Link>
              </nav>
            </div>

            <div className="flex flex-col gap-2.5">
              <h3 className="font-mono text-[10px] uppercase tracking-widest text-foreground">Governance</h3>
              <nav className="flex flex-col gap-1.5 font-serif text-xs text-muted-foreground">
                <Link href="/privacy" className="hover:text-foreground">Privacy Policy</Link>
                <Link href="/terms" className="hover:text-foreground">Terms and Conditions</Link>
                <span className="text-muted-foreground/70">HIPAA Security Safeguards</span>
                <span className="text-muted-foreground/70">AWS Cloud Infrastructure</span>
              </nav>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-start justify-between gap-4 border-t border-border pt-6 font-mono text-[11px] text-muted-foreground sm:flex-row sm:items-center">
            <p>&copy; {new Date().getFullYear()} Vitalis Health Systems. All rights reserved.</p>
            <p className="font-serif text-[11px] italic text-muted-foreground">
              Notice: Vitalis is not an emergency response service. In medical emergencies, dial 911 immediately.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
