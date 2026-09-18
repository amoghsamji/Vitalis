import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import { buttonVariants as shadcnButtonVariants } from "@/components/ui/shadcn/button";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

// Vitalis's own variant/size names, mapped onto the shadcn button's variants
// so every existing call site keeps working unchanged.
const variantMap: Record<ButtonVariant, "default" | "outline" | "destructive" | "ghost"> = {
  primary: "default",
  secondary: "outline",
  danger: "destructive",
  ghost: "ghost",
};

const sizeMap: Record<ButtonSize, "default" | "sm"> = {
  sm: "sm",
  md: "default",
};

export function buttonVariants({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return cn(shadcnButtonVariants({ variant: variantMap[variant], size: sizeMap[size] }), className);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", icon, className, children, ...props }, ref) => (
    <button ref={ref} className={buttonVariants({ variant, size, className })} {...props}>
      {icon}
      {children}
    </button>
  )
);
Button.displayName = "Button";
