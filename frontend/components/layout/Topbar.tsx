"use client";

import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Avatar, AvatarFallback } from "@/components/ui/shadcn/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/shadcn/dropdown-menu";

function initials(nameOrEmail: string) {
  const clean = nameOrEmail.trim();
  if (clean.includes(" ")) {
    const parts = clean.split(" ");
    if (parts[0] && parts[parts.length - 1]) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
  }
  return clean.slice(0, 2).toUpperCase();
}

export function Topbar() {
  const { session, signOut } = useAuth();
  const [syncTime, setSyncTime] = useState("");

  useEffect(() => {
    function tick() {
      setSyncTime(new Date().toTimeString().split(" ")[0]);
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!session) return null;

  const displayName = session.name || session.givenName || session.email;

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-background px-6">
      <div className="flex items-center gap-4">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          SESSION ACTIVE // SECURE ENCLAVE
        </div>
        <span className="hidden sm:inline-block h-3 w-px bg-border" />
        <div className="hidden sm:flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <span>LAST SYNCED</span>
          <span className="text-primary font-medium">{syncTime || "12:00:00"} UTC</span>
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2.5 rounded-[2px] border border-border bg-card px-2.5 py-1 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-foreground">
          <Avatar className="h-6 w-6 rounded-[2px]">
            <AvatarFallback className="rounded-[2px] font-mono text-[10px] bg-primary/10 text-primary font-semibold">
              {initials(displayName)}
            </AvatarFallback>
          </Avatar>
          <span className="font-mono text-xs text-foreground font-medium">{displayName}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="rounded-[2px] border border-border bg-card shadow-none">
          <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {displayName} <span className="text-[9px] lowercase font-normal block opacity-80">{session.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={signOut} className="gap-2 font-mono text-xs text-destructive focus:text-destructive">
            <LogOut className="h-3.5 w-3.5 stroke-[1.5]" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

