"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-card sm:flex">
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
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {links.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 rounded-[2px] px-3 py-2 font-mono text-xs uppercase tracking-wider transition-colors",
                active
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5 stroke-[1.5]" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
