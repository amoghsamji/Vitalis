import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface StepperProps {
  steps: string[];
  currentIndex: number;
  className?: string;
}

export function Stepper({ steps, currentIndex, className }: StepperProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {steps.map((step, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        return (
          <div key={step} className="flex flex-1 items-center gap-2">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-[2px] font-mono text-[10px] font-medium",
                  done && "bg-primary text-primary-foreground",
                  active && "border border-primary bg-primary text-primary-foreground",
                  !done && !active && "border border-border text-muted-foreground bg-card"
                )}
              >
                {done ? <Check className="h-3 w-3 stroke-[2.5]" /> : i + 1}
              </span>
              <span className={cn("font-mono text-xs uppercase tracking-wider", active ? "font-semibold text-foreground" : "text-muted-foreground")}>
                {step}
              </span>
            </div>
            {i < steps.length - 1 && <div className="h-px flex-1 bg-border" />}
          </div>
        );
      })}
    </div>
  );
}
