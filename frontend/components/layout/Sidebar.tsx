"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Calendar, Clock, LayoutDashboard, Search, Stethoscope, User, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/types";

const patientLinks = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/patient/doctors", label: "Find a doctor", icon: Search },
  { href: "/patient/appointments", label: "My appointments", icon: Calendar },
  { href: "/patient/profile", label: "Profile", icon: User },
];

const doctorLinks = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/doctor/appointments", label: "Appointments", icon: Calendar },
  { href: "/doctor/availability", label: "Availability", icon: Clock },
  { href: "/doctor/workflows", label: "Workflows", icon: Workflow },
  { href: "/doctor/profile", label: "Profile", icon: User },
];

export function Sidebar({ role }: { role: Role | null }) {
  const pathname = usePathname();
  const links = role === "doctor" ? doctorLinks : patientLinks;
  const [timeStr, setTimeStr] = useState("");

  useEffect(() => {
    function tick() {
      setTimeStr(new Date().toTimeString().split(" ")[0]);
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <aside className="hidden w-56 shrink-0 flex-col justify-between border-r border-border bg-card sm:flex">
      <div className="flex flex-col">
        {/* Header brand */}
        <div className="flex h-14 items-center justify-between border-b border-border px-5">
          <Link href="/dashboard" className="flex items-center gap-2 font-serif text-lg font-semibold tracking-tight text-foreground">
            <span className="flex h-6 w-6 items-center justify-center rounded-[2px] border border-primary/40 bg-primary/10 text-primary">
              <Stethoscope className="h-3.5 w-3.5" />
            </span>
            <span>Vitalis</span>
          </Link>
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
            {role ?? "PORTAL"}
          </span>
        </div>

        {/* Navigation rail with tight padding and // NAVIGATION section label */}
        <div className="p-3">
          <div className="px-2 pt-2 pb-1.5 font-mono text-[9px] uppercase tracking-widest text-primary font-medium">
            // NAVIGATION
          </div>
          <nav className="flex flex-col gap-0.5">
            {links.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-[2px] px-2.5 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors",
                    active
                      ? "border-l-[3px] border-primary bg-primary/5 text-foreground font-semibold pl-2"
                      : "border-l-[3px] border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground pl-2"
                  )}
                >
                  <Icon className={cn("h-3.5 w-3.5 stroke-[1.5]", active ? "text-primary" : "text-muted-foreground")} />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Pinned bottom status panel */}
      <div className="p-3 border-t border-border bg-card/60">
        <div className="rounded-[2px] border border-border bg-background/50 p-2.5 font-mono text-[10px]">
          <div className="flex items-center justify-between border-b border-border pb-1 text-muted-foreground">
            <span className="uppercase tracking-widest text-[8px]">ACTIVE SESSION</span>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-700 animate-status-pulse" />
          </div>
          <div className="mt-1.5 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="uppercase tracking-wider text-[9px] text-muted-foreground">ROLE</span>
              <span className="font-semibold text-foreground uppercase">{role ?? "PATIENT"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="uppercase tracking-wider text-[9px] text-muted-foreground">LOCAL CLOCK</span>
              <span className="font-semibold text-primary">{timeStr || "12:00:00"}</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

