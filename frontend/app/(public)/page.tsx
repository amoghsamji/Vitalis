"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

const capabilities = [
  {
    num: "01",
    title: "Clinical Scheduling & Availability",
    description:
      "Physicians configure consult slots and booking rules. Patients view real-time availability and confirm appointments with automated status tracking.",
    spec: "SPEC: REAL-TIME DYNAMODB SLOT LOCKING",
  },
  {
    num: "02",
    title: "Diagnostic Lab Intake",
    description:
      "Clinical teams upload laboratory reports in PDF format with automated metadata extraction into patient history and condition records.",
    spec: "SPEC: SERVERLESS S3 + TEXTRACT PIPELINE",
  },
  {
    num: "03",
    title: "Auditable Care Workflows",
    description:
      "Build condition-based outreach pipelines that trigger verified telephone checks or SMS reminders with full execution audit logs.",
    spec: "SPEC: AMAZON CONNECT + LEX V2 INTEGRATION",
  },
];

const statBlocks = [
  { label: "Security", val: "HIPAA Safeguards" },
  { label: "Auth", val: "Cognito MFA Ready" },
  { label: "Storage", val: "Encrypted at Rest" },
  { label: "Audit", val: "Step Function Logs" },
];

const architectureHighlights = [
  {
    tag: "AUTH.01",
    title: "Role-Based Access Control",
    description:
      "Strict separation between patient and physician roles enforced via Amazon Cognito user pools and token claims.",
  },
  {
    tag: "STORE.02",
    title: "Pay-Per-Use Cloud Storage",
    description:
      "DynamoDB single-table design with encrypted storage at rest (AES-256) and zero idle compute overhead.",
  },
  {
    tag: "TELE.03",
    title: "Telephony Follow-Up Protocols",
    description:
      "Automated outreach requires explicit patient consent and identity verification prior to discussing any health records.",
  },
];

export default function HomePage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [timeString, setTimeString] = useState<string>("");
  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (loading || !session) return;
    router.replace("/dashboard");
  }, [loading, session, router]);

  useEffect(() => {
    function updateClock() {
      const now = new Date();
      setTimeString(now.toTimeString().split(" ")[0]);
    }
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute("data-reveal-id");
            if (id) {
              setRevealedIds((prev) => ({ ...prev, [id]: true }));
              observer.unobserve(entry.target);
            }
          }
        });
      },
      { threshold: 0.15 }
    );

    const elements = document.querySelectorAll("[data-reveal-id]");
    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex flex-col gap-14 py-1">
      {/* Outer Margin Annotation: Top */}
      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground select-none px-1">
        <span className="hidden sm:inline-block">VITALIS // CLINICAL REPOSITORY</span>
        <span className="ml-auto">FIG. 01 — SYSTEM OVERVIEW</span>
      </div>

      {/* Editorial Chart Hero (Bounded Document with top & bottom 2px maroon rules) */}
      <section className="relative border border-border border-t-2 border-t-primary border-b-2 border-b-primary bg-card rounded-[2px]">
        {/* 4 Corner Registration Marks (Print crop mark brackets in maroon accent) */}
        <svg className="pointer-events-none absolute -top-2 -left-2 h-4 w-4 stroke-primary" fill="none" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M16 1H1V16" strokeWidth="1" />
        </svg>
        <svg className="pointer-events-none absolute -top-2 -right-2 h-4 w-4 stroke-primary" fill="none" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M0 1H15V16" strokeWidth="1" />
        </svg>
        <svg className="pointer-events-none absolute -bottom-2 -left-2 h-4 w-4 stroke-primary" fill="none" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M16 15H1V0" strokeWidth="1" />
        </svg>
        <svg className="pointer-events-none absolute -bottom-2 -right-2 h-4 w-4 stroke-primary" fill="none" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M0 15H15V0" strokeWidth="1" />
        </svg>

        {/* Hero Body: 55/45 split between narrative and live clinical visual */}
        <div className="p-8 sm:p-12">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-start">
            {/* Left Narrative Column (~58%) with margin line numbers */}
            <div className="lg:col-span-7 flex gap-4 sm:gap-6">
              {/* Vertical Rule with Line Numbers (Margin Annotations) */}
              <div className="hidden sm:flex flex-col items-center border-r border-border pr-3 text-muted-foreground select-none font-mono text-[9px]">
                <span title="Line 01">01</span>
                <div className="my-2.5 w-px flex-1 min-h-[14px] bg-border/70" />
                <span title="Line 02">02</span>
                <div className="my-5 w-px flex-1 min-h-[70px] bg-border/70" />
                <span title="Line 03">03</span>
                <div className="my-5 w-px flex-1 min-h-[40px] bg-border/70" />
                <span title="Line 04">04</span>
              </div>

              {/* Text Blocks with Staggered Load-In */}
              <div className="flex-1 min-w-0">
                {/* 01: Eyebrow / Classification Tag */}
                <div className="flex items-center gap-2 animate-hero-eyebrow">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-primary font-medium">
                    [REF: OPS-INFRASTRUCTURE]
                  </span>
                  <span className="h-3 w-px bg-border" />
                  <span className="font-mono text-[10px] uppercase tracking-widest text-foreground font-medium">
                    Healthcare Operations Infrastructure
                  </span>
                </div>

                {/* 02: Headline with Redaction Slide Reveal */}
                <div className="relative mt-6 overflow-hidden animate-hero-headline">
                  <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-[2.75rem] sm:leading-[1.12]">
                    Clinical Coordination and Patient Follow-Up Infrastructure
                  </h1>
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 bg-primary z-10 animate-redaction-bar"
                  />
                </div>

                {/* 03: Constrained line length serif body copy */}
                <p className="mt-5 max-w-[58ch] font-serif text-base leading-relaxed text-muted-foreground sm:text-lg animate-hero-paragraph">
                  Vitalis connects doctors and patients through verified scheduling, structured diagnostic lab intake,
                  and automated care workflows built entirely on secure AWS cloud architecture.
                </p>

                {/* 04: Rectangular Mono CTA Buttons */}
                <div className="mt-8 flex flex-wrap items-center gap-3 animate-hero-cta">
                  <Link
                    href="/login"
                    className={buttonVariants({
                      variant: "default",
                      size: "lg",
                      className: "px-6",
                    })}
                  >
                    Sign in to Portal
                  </Link>
                  <Link
                    href="/signup"
                    className={buttonVariants({
                      variant: "outline",
                      size: "lg",
                      className: "px-6",
                    })}
                  >
                    Create New Account
                  </Link>
                </div>
              </div>
            </div>

            {/* Right Column (~42%): Animated ECG Waveform + Live Patient Intake Card */}
            <div className="lg:col-span-5 flex flex-col gap-5 border-t border-border pt-6 lg:border-t-0 lg:border-l lg:border-border lg:pl-8 lg:pt-0 animate-hero-paragraph">
              {/* Telemetry Waveform Card */}
              <div className="rounded-[2px] border border-border bg-card p-4">
                <div className="flex items-center justify-between border-b border-border pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-none bg-primary" />
                    <span className="font-mono text-[10px] uppercase tracking-widest text-foreground font-medium">
                      TELEMETRY // LEAD II (CH-A)
                    </span>
                  </div>
                  <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                    250 HZ // ACTIVE
                  </span>
                </div>

                {/* ECG Trace Screen with faint hairline grid */}
                <div className="relative mt-3 rounded-[2px] border border-border bg-background/50 p-2 overflow-hidden">
                  <div
                    className="pointer-events-none absolute inset-0 opacity-15"
                    style={{
                      backgroundImage:
                        "linear-gradient(to right, rgba(122,46,46,0.3) 1px, transparent 1px), linear-gradient(to bottom, rgba(122,46,46,0.3) 1px, transparent 1px)",
                      backgroundSize: "14px 14px",
                    }}
                    aria-hidden="true"
                  />
                  <svg viewBox="0 0 340 70" className="w-full h-16 stroke-primary fill-none relative z-10 overflow-visible">
                    <path
                      d="M 0,35 L 35,35 L 45,35 Q 52,28 60,35 L 75,35 L 82,43 L 90,6 L 98,64 L 105,35 L 120,35 Q 130,22 140,35 L 170,35 L 180,35 Q 187,28 195,35 L 210,35 L 217,43 L 225,6 L 233,64 L 240,35 L 255,35 Q 265,22 275,35 L 340,35"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="animate-ecg-draw"
                    />
                    <circle r="2.5" className="fill-primary">
                      <animateMotion
                        path="M 0,35 L 35,35 L 45,35 Q 52,28 60,35 L 75,35 L 82,43 L 90,6 L 98,64 L 105,35 L 120,35 Q 130,22 140,35 L 170,35 L 180,35 Q 187,28 195,35 L 210,35 L 217,43 L 225,6 L 233,64 L 240,35 L 255,35 Q 265,22 275,35 L 340,35"
                        dur="4s"
                        repeatCount="indefinite"
                        begin="1.2s"
                      />
                      <animate attributeName="opacity" values="0;1;1;0" dur="4s" repeatCount="indefinite" begin="1.2s" />
                    </circle>
                  </svg>
                </div>
              </div>

              {/* Live Document Intake Card */}
              <div className="rounded-[2px] border border-border bg-card p-4 font-mono text-[11px]">
                <div className="flex items-center justify-between border-b border-border pb-2.5">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">INTAKE RECORD</span>
                  <span className="text-[9px] uppercase tracking-wider text-primary font-medium">LIVE AUDIT FEED</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground">SYSTEM STATUS</p>
                    <p className="mt-0.5 font-semibold text-foreground">ONLINE // NOMINAL</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground">LAST SYNC</p>
                    <p className="mt-0.5 font-semibold text-primary">{timeString || "12:00:00"} UTC</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground">UPTIME</p>
                    <p className="mt-0.5 font-semibold text-foreground">99.99% AWS-EAST</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground">ENCRYPTION</p>
                    <p className="mt-0.5 font-semibold text-foreground">AES-256 REST</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Letterhead / Document Footer Stat Strip (Scroll Animated with Stagger) */}
        <div className="grid grid-cols-2 divide-y divide-border border-t border-border sm:grid-cols-4 sm:divide-y-0 sm:divide-x">
          {statBlocks.map(({ label, val }, index) => (
            <div
              key={label}
              data-reveal-id={`stat-${index}`}
              style={{
                transitionDelay: `${index * 60}ms`,
              }}
              className={cn(
                "p-4 sm:px-6 transition-all duration-300 ease-out",
                revealedIds[`stat-${index}`]
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-[10px]"
              )}
            >
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
              <p className="mt-1 font-serif text-sm font-semibold tracking-tight text-foreground">{val}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Outer Margin Annotation: Bottom */}
      <div className="-mt-8 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground select-none px-1">
        <span>REV. 2026.09</span>
        <span className="hidden sm:inline-block">SECTION INDEX: 01-03</span>
      </div>

      {/* Core Operational Capabilities */}
      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-1 border-b border-border pb-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-primary font-medium">
            // CORE CAPABILITIES
          </p>
          <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
            Standardized Clinical Operations
          </h2>
          <p className="font-serif text-sm text-muted-foreground max-w-[65ch]">
            Standardized tools designed for clinical precision, patient safety, and regulatory compliance.
          </p>
        </div>

        {/* 3-Column Ledger Cards with Numbered Mono Headers (Scroll Animated with Stagger) */}
        <div className="grid gap-6 sm:grid-cols-3">
          {capabilities.map(({ num, title, description, spec }, index) => (
            <div
              key={title}
              data-reveal-id={`cap-${index}`}
              style={{
                transitionDelay: `${index * 60}ms`,
              }}
              className={cn(
                "flex flex-col justify-between rounded-[2px] border border-border bg-card transition-all duration-300 ease-out",
                revealedIds[`cap-${index}`]
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-[10px]"
              )}
            >
              <div className="p-6">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <span className="font-mono text-xs font-semibold tracking-widest text-primary">
                    SECTION {num}
                  </span>
                  <span className="rounded-[2px] border border-primary/40 bg-primary/5 px-1.5 py-0.2 font-mono text-[9px] uppercase tracking-wider text-primary font-medium">
                    READY
                  </span>
                </div>
                <h3 className="mt-4 font-serif text-lg font-semibold leading-snug tracking-tight text-foreground">
                  {title}
                </h3>
                <p className="mt-2.5 font-serif text-sm leading-relaxed text-muted-foreground">
                  {description}
                </p>
              </div>

              {/* Citation/Footnote Metadata Line under thin rule */}
              <div className="border-t border-border bg-muted/20 px-6 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {spec}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Architecture & Governance Section */}
      <section className="rounded-[2px] border border-border bg-card p-6 sm:p-8">
        <div className="max-w-[70ch]">
          <p className="font-mono text-[10px] uppercase tracking-widest text-primary font-medium">
            // DATA GOVERNANCE &amp; ARCHITECTURE
          </p>
          <h2 className="mt-1 font-serif text-2xl font-semibold tracking-tight text-foreground">
            Architecture and Data Governance
          </h2>
          <p className="mt-2 font-serif text-sm leading-relaxed text-muted-foreground">
            Healthcare data requires strict partitioning and auditability. Vitalis is engineered according to AWS Well-Architected healthcare principles.
          </p>
        </div>

        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {architectureHighlights.map(({ tag, title, description }) => (
            <div
              key={title}
              className="flex flex-col gap-2 rounded-[2px] border border-border bg-background p-5"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] tracking-widest text-primary font-medium">
                  [{tag}]
                </span>
              </div>
              <h4 className="font-serif text-base font-semibold text-foreground">
                {title}
              </h4>
              <p className="font-serif text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
            </div>
          ))}
        </div>

        {/* Footer Links Bar */}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
          <p className="font-serif text-xs text-muted-foreground">
            Learn more about our data handling commitments in the legal documentation.
          </p>
          <div className="flex items-center gap-6 font-mono text-xs uppercase tracking-wider">
            <Link href="/privacy" className="inline-flex items-center gap-1.5 text-foreground hover:underline">
              Read Privacy Policy <ArrowRight className="h-3 w-3" />
            </Link>
            <Link href="/terms" className="inline-flex items-center gap-1.5 text-foreground hover:underline">
              Read Terms and Conditions <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
