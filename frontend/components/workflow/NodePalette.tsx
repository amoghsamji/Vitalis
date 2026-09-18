import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { ActionType, ConditionCheck, OutputType, TriggerType } from "@/lib/types";
import { ACTION_LABELS, CONDITION_LABELS, FUNCTIONAL_ACTIONS, OUTPUT_LABELS, TRIGGER_LABELS } from "./labels";

interface NodePaletteProps {
  hasTrigger: boolean;
  onAddTrigger: (triggerType: TriggerType) => void;
  onAddCondition: (check: ConditionCheck) => void;
  onAddAction: (action: ActionType) => void;
  onAddOutput: (output: OutputType) => void;
}

function PaletteButton({ label, onClick, badge }: { label: string; onClick: () => void; badge?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-md border border-border px-2.5 py-1.5 text-left text-xs transition-colors hover:border-primary/40 hover:bg-accent"
    >
      <span>{label}</span>
      {badge}
    </button>
  );
}

export function NodePalette({ hasTrigger, onAddTrigger, onAddCondition, onAddAction, onAddOutput }: NodePaletteProps) {
  return (
    <Card padding="sm" className="flex w-64 shrink-0 flex-col gap-4 self-start">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Trigger</h3>
        {hasTrigger ? (
          <p className="text-xs text-muted-foreground/70">Every workflow starts with one trigger — already on the canvas.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {(Object.keys(TRIGGER_LABELS) as TriggerType[]).map((t) => (
              <PaletteButton key={t} label={TRIGGER_LABELS[t]} onClick={() => onAddTrigger(t)} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Condition</h3>
        <div className="flex flex-col gap-1.5">
          {(Object.keys(CONDITION_LABELS) as ConditionCheck[]).map((c) => (
            <PaletteButton key={c} label={CONDITION_LABELS[c]} onClick={() => onAddCondition(c)} />
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Action</h3>
        <div className="flex flex-col gap-1.5">
          {(Object.keys(ACTION_LABELS) as ActionType[]).map((a) => (
            <PaletteButton
              key={a}
              label={ACTION_LABELS[a]}
              onClick={() => onAddAction(a)}
              badge={
                <Badge variant={FUNCTIONAL_ACTIONS.includes(a) ? "success" : "neutral"}>
                  {FUNCTIONAL_ACTIONS.includes(a) ? "Live" : "Logged"}
                </Badge>
              }
            />
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Output</h3>
        <div className="flex flex-col gap-1.5">
          {(Object.keys(OUTPUT_LABELS) as OutputType[]).map((o) => (
            <PaletteButton key={o} label={OUTPUT_LABELS[o]} onClick={() => onAddOutput(o)} />
          ))}
        </div>
      </div>
    </Card>
  );
}
