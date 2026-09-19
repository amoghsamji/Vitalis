import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type SparklineType = "trend" | "bars" | "pulse";

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  subtext?: string;
  sparkline?: SparklineType;
  className?: string;
}

export function StatCard({
  icon: Icon,
  label,
  value,
  subtext,
  sparkline = "trend",
  className,
}: StatCardProps) {
  return (
    <div className={cn("rounded-[2px] border border-border bg-card p-4 flex flex-col justify-between", className)}>
      <div>
        <div className="flex items-center justify-between border-b border-border/60 pb-2">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
          <Icon className="h-3.5 w-3.5 text-muted-foreground stroke-[1.5]" />
        </div>

        <div className="mt-3 flex items-baseline justify-between gap-2">
          <p className="font-serif text-3xl font-semibold tracking-tight text-foreground">{value}</p>

          {/* Minimal flat sparkline / bar indicator (pure line/bars, no fill, ink or maroon) */}
          <div className="flex items-center self-center" aria-hidden="true">
            {sparkline === "trend" && (
              <svg viewBox="0 0 54 16" className="h-4 w-14 stroke-primary fill-none overflow-visible">
                <polyline
                  points="1,12 10,10 19,13 28,6 37,8 46,2 53,4"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            {sparkline === "bars" && (
              <div className="flex items-end gap-1 h-3.5">
                <span className="w-1 bg-foreground/70 h-1.5" />
                <span className="w-1 bg-foreground/70 h-2.5" />
                <span className="w-1 bg-foreground/70 h-2" />
                <span className="w-1 bg-primary h-3.5" />
                <span className="w-1 bg-foreground/70 h-2.5" />
              </div>
            )}
            {sparkline === "pulse" && (
              <svg viewBox="0 0 54 16" className="h-4 w-14 stroke-foreground fill-none overflow-visible">
                <path
                  d="M 1,8 L 15,8 L 19,3 L 23,13 L 27,8 L 53,8"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </div>
        </div>
      </div>

      {/* Contextual subtext under the number */}
      {subtext && (
        <p className="mt-2.5 pt-2 border-t border-border/50 font-mono text-[10px] text-muted-foreground tracking-wide truncate">
          {subtext}
        </p>
      )}
    </div>
  );
}

