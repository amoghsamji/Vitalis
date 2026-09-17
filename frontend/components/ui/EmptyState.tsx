import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "./Button";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  message: string;
  cta?: { label: string; href: string };
  className?: string;
}

// Page/section-level empties only ("No doctors found", "No appointments
// yet") — not for small inline list-empty lines inside compact cards,
// where a full EmptyState would be oversized.
export function EmptyState({ icon: Icon, message, cta, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-300 py-10 text-center",
        className
      )}
    >
      {Icon && <Icon className="h-8 w-8 text-slate-300" />}
      <p className="text-sm text-slate-500">{message}</p>
      {cta && (
        <Link href={cta.href} className={buttonVariants({ variant: "secondary", size: "sm" })}>
          {cta.label}
        </Link>
      )}
    </div>
  );
}
