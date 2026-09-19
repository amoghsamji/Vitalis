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
// yet"): not for small inline list-empty lines inside compact cards,
// where a full EmptyState would be oversized.
export function EmptyState({ icon: Icon, message, cta, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-[2px] border border-dashed border-border bg-card/40 py-10 text-center",
        className
      )}
    >
      {Icon && <Icon className="h-6 w-6 stroke-[1.5] text-muted-foreground/50" />}
      <p className="font-serif text-sm text-muted-foreground max-w-prose">{message}</p>
      {cta && (
        <Link href={cta.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
          {cta.label}
        </Link>
      )}
    </div>
  );
}
