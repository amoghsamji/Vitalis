"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Search, Calendar, Clock, User, LogOut, Workflow } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Button, buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

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

export function NavBar() {
  const { session, role, signOut, loading } = useAuth();
  const pathname = usePathname();
  const links = role === "doctor" ? doctorLinks : patientLinks;

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href={session ? "/dashboard" : "/"} className="text-lg font-semibold text-brand-700">
          Vitalis
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {loading ? null : session ? (
            <>
              {links.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-1.5 text-slate-600 hover:text-slate-900",
                    pathname === href && "font-medium text-brand-700"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              ))}
              <span className="text-slate-400">{session.email}</span>
              <Button variant="ghost" size="sm" onClick={signOut} icon={<LogOut className="h-4 w-4" />}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Link href="/login">Sign in</Link>
              <Link href="/signup" className={buttonVariants({ variant: "primary" })}>
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
