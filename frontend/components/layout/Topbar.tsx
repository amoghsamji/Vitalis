"use client";

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

function initials(email: string) {
  return email.slice(0, 2).toUpperCase();
}

export function Topbar() {
  const { session, signOut } = useAuth();
  if (!session) return null;

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-background px-6">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        SESSION ACTIVE // SECURE ENCLAVE
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2.5 rounded-[2px] border border-border bg-card px-2.5 py-1 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-foreground">
          <Avatar className="h-6 w-6 rounded-[2px]">
            <AvatarFallback className="rounded-[2px] font-mono text-[10px]">{initials(session.email)}</AvatarFallback>
          </Avatar>
          <span className="font-mono text-xs text-foreground">{session.email}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="rounded-[2px] border border-border bg-card shadow-none">
          <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{session.email}</DropdownMenuLabel>
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
