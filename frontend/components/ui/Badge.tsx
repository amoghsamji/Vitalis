import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type BadgeVariant = "success" | "warning" | "danger" | "neutral" | "info";

const variantClasses: Record<BadgeVariant, string> = {
  success: "border-emerald-700/30 bg-emerald-50/50 text-emerald-900",
  warning: "border-amber-700/30 bg-amber-50/50 text-amber-900",
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
  neutral: "border-border bg-muted/50 text-muted-foreground",
  info: "border-border bg-card text-foreground",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ variant = "neutral", className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[2px] border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        variantClasses[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
