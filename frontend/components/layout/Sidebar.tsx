"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calendar, Clock, LayoutDashboard, Search, User, Workflow } from "lucide-react";
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
      <div className="flex h-14 items-center border-b border-border px-5">
        <Link href="/dashboard" className="text-base font-semibold tracking-tight text-foreground">
          Vitalis
        </Link>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {links.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
