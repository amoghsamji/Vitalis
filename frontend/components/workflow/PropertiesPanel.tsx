import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Trash2 } from "lucide-react";
import type { FlowNode } from "@/lib/workflowGraph";
import { FUNCTIONAL_ACTIONS } from "./labels";

interface PropertiesPanelProps {
  node: FlowNode | null;
  onChangeParams: (nodeId: string, params: Record<string, string | number>) => void;
  onDelete: (nodeId: string) => void;
}

export function PropertiesPanel({ node, onChangeParams, onDelete }: PropertiesPanelProps) {
  if (!node) {
    return (
      <Card padding="sm" className="w-72 shrink-0 self-start text-sm text-slate-400">
        Select a node to edit its settings.
      </Card>
    );
  }

  const { data } = node;

  return (
    <Card padding="sm" className="flex w-72 shrink-0 flex-col gap-3 self-start">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Properties</h3>
        {data.kind !== "trigger" && (
          <Button variant="ghost" size="sm" onClick={() => onDelete(node.id)} icon={<Trash2 className="h-3.5 w-3.5" />}>
            Delete
          </Button>
        )}
      </div>

      {data.kind === "trigger" && <p className="text-xs text-slate-500">Trigger type is fixed once the workflow is created.</p>}

      {data.kind === "condition" && data.check === "value_greater_than" && (
        <>
          <TextField
            label="Field name"
            value={String(data.params.field ?? "")}
            onChange={(v) => onChangeParams(node.id, { ...data.params, field: v })}
          />
          <TextField
            label="Threshold"
            value={String(data.params.threshold ?? "")}
            onChange={(v) => onChangeParams(node.id, { ...data.params, threshold: v })}
          />
        </>
      )}

      {data.kind === "condition" && data.check === "patient_age_gt" && (
        <TextField
          label="Age"
          value={String(data.params.age ?? "")}
          onChange={(v) => onChangeParams(node.id, { ...data.params, age: v })}
        />
      )}

      {data.kind === "condition" && data.check === "always_true" && (
        <p className="text-xs text-slate-500">No parameters — this branch is always taken.</p>
      )}

      {data.kind === "action" && data.action === "send_sms" && (
        <>
          <TextField
            label="Message"
            multiline
            value={String(data.params.message ?? "")}
            onChange={(v) => onChangeParams(node.id, { ...data.params, message: v })}
          />
          <TextField
            label="Phone override (optional)"
            value={String(data.params.phoneNumber ?? "")}
            onChange={(v) => onChangeParams(node.id, { ...data.params, phoneNumber: v })}
          />
          <p className="text-xs text-slate-400">
            Leave phone blank to use the patient&apos;s number from their profile automatically.
          </p>
        </>
      )}

      {data.kind === "action" && !FUNCTIONAL_ACTIONS.includes(data.action) && (
        <p className="text-xs text-slate-500">
          This action is a logged-only stub for now — it records that this step ran but doesn&apos;t call an external
          service yet.
        </p>
      )}

      {data.kind === "output" && (
        <TextField
          label="Note"
          multiline
          value={String(data.params.note ?? "")}
          onChange={(v) => onChangeParams(node.id, { ...data.params, note: v })}
        />
      )}
    </Card>
  );
}

function TextField({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {multiline ? (
        <textarea className="input" rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
