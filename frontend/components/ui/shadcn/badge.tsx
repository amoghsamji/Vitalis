import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center rounded-[2px] border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-foreground",
        secondary: "border-border bg-muted/60 text-foreground",
        destructive: "border-destructive/40 bg-destructive/10 text-destructive",
        success: "border-emerald-700/30 bg-emerald-50/50 text-emerald-900",
        warning: "border-amber-700/30 bg-amber-50/50 text-amber-900",
        outline: "border-border bg-transparent text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface ShadcnBadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function ShadcnBadge({ className, variant, ...props }: ShadcnBadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
