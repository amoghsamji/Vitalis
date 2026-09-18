import { Handle, Position, type NodeProps } from "reactflow";
import { Zap, GitBranch, PlayCircle, FileCheck2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import type { FlowNodeData } from "@/lib/workflowGraph";
import { ACTION_LABELS, CONDITION_LABELS, FUNCTIONAL_ACTIONS, OUTPUT_LABELS, TRIGGER_LABELS } from "./labels";

const nodeShell = "min-w-[180px] rounded-lg border bg-card px-3 py-2 shadow-sm text-sm";

export function TriggerNode({ data, selected }: NodeProps<FlowNodeData>) {
  if (data.kind !== "trigger") return null;
  return (
    <div className={cn(nodeShell, "border-primary/40", selected && "ring-2 ring-primary")}>
      <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
        <Zap className="h-3.5 w-3.5" /> Trigger
      </div>
      <p className="mt-1 font-medium">{TRIGGER_LABELS[data.triggerType]}</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export function ConditionNode({ data, selected }: NodeProps<FlowNodeData>) {
  if (data.kind !== "condition") return null;
  return (
    <div className={cn(nodeShell, "border-border", selected && "ring-2 ring-primary")}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <GitBranch className="h-3.5 w-3.5" /> Condition
      </div>
      <p className="mt-1 font-medium">{CONDITION_LABELS[data.check]}</p>
      {data.params.field !== undefined && (
        <p className="text-xs text-muted-foreground">
          {String(data.params.field)} &gt; {String(data.params.threshold ?? data.params.age ?? "")}
        </p>
      )}
      <div className="mt-2 flex justify-between text-[10px] font-medium">
        <span className="text-success-700">True</span>
        <span className="text-destructive">False</span>
      </div>
      <Handle type="source" position={Position.Bottom} id="true" style={{ left: "30%" }} />
      <Handle type="source" position={Position.Bottom} id="false" style={{ left: "70%" }} />
    </div>
  );
}

export function ActionNode({ data, selected }: NodeProps<FlowNodeData>) {
  if (data.kind !== "action") return null;
  const isFunctional = FUNCTIONAL_ACTIONS.includes(data.action);
  return (
    <div className={cn(nodeShell, "border-border", selected && "ring-2 ring-primary")}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <PlayCircle className="h-3.5 w-3.5" /> Action
        </div>
        <Badge variant={isFunctional ? "success" : "neutral"}>{isFunctional ? "Live" : "Logged only"}</Badge>
      </div>
      <p className="mt-1 font-medium">{ACTION_LABELS[data.action]}</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export function OutputNode({ data, selected }: NodeProps<FlowNodeData>) {
  if (data.kind !== "output") return null;
  return (
    <div className={cn(nodeShell, "border-border", selected && "ring-2 ring-primary")}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <FileCheck2 className="h-3.5 w-3.5" /> Output
      </div>
      <p className="mt-1 font-medium">{OUTPUT_LABELS[data.output]}</p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export const nodeTypes = {
  trigger: TriggerNode,
  condition: ConditionNode,
  action: ActionNode,
  output: OutputNode,
};
