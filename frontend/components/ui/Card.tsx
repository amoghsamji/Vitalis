import { type HTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export type CardPadding = "none" | "sm" | "md";

const baseClasses = "rounded-lg border border-slate-200 bg-white shadow-sm";

// Padding is a variant, not something callers override via a trailing
// className string — Tailwind's generated stylesheet order (not className
// concatenation order) decides which same-specificity utility wins, so
// cn(cardVariants(), "py-3") isn't guaranteed to beat a baked-in p-5.
const paddingClasses: Record<CardPadding, string> = {
  none: "",
  sm: "px-4 py-3",
  md: "p-5",
};

export function cardVariants({
  padding = "md",
  className,
}: {
  padding?: CardPadding;
  className?: string;
} = {}) {
  return cn(baseClasses, paddingClasses[padding], className);
}

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ padding = "md", className, ...props }, ref) => (
    <div ref={ref} className={cardVariants({ padding, className })} {...props} />
  )
);
Card.displayName = "Card";
