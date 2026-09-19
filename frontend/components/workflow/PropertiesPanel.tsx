import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/shadcn/input";
import { Textarea } from "@/components/ui/shadcn/textarea";
import { Label } from "@/components/ui/shadcn/label";
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
      <Card padding="sm" className="w-72 shrink-0 self-start text-sm text-muted-foreground/70">
        Select a node to edit its settings.
      </Card>
    );
  }

  const { data } = node;

  return (
    <Card padding="sm" className="flex w-72 shrink-0 flex-col gap-3 self-start">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Properties</h3>
        {data.kind !== "trigger" && (
          <Button variant="ghost" size="sm" onClick={() => onDelete(node.id)} icon={<Trash2 className="h-3.5 w-3.5" />}>
            Delete
          </Button>
        )}
      </div>

      {data.kind === "trigger" && <p className="text-xs text-muted-foreground">Trigger type is fixed once the workflow is created.</p>}

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
        <p className="text-xs text-muted-foreground">No parameters: this branch is always taken.</p>
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
          <p className="text-xs text-muted-foreground/70">
            Leave phone blank to use the patient&apos;s number from their profile automatically.
          </p>
        </>
      )}

      {data.kind === "action" && data.action === "call_patient" && (
        <>
          <TextField
            label="Follow-up timing (days after appointment)"
            value={String(data.params.followUpDelayDays ?? "3")}
            onChange={(v) => onChangeParams(node.id, { ...data.params, followUpDelayDays: v })}
          />
          <div className="flex flex-col gap-1.5">
            <Label>If the patient can't be reached / understood</Label>
            <select
              className="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
              value={String(data.params.fallbackBehavior ?? "notify_doctor")}
              onChange={(e) => onChangeParams(node.id, { ...data.params, fallbackBehavior: e.target.value })}
            >
              <option value="notify_doctor">Repeat once, then notify doctor</option>
              <option value="retry_next_day">Repeat once, then retry the call next day</option>
            </select>
          </div>
          <p className="text-xs text-muted-foreground/70">
            Calls an automated Amazon Connect + Lex voice bot that verifies the patient, asks how they&apos;re
            feeling, and can offer to book a follow-up appointment. Only fires for patients who&apos;ve opted in
            (see their profile). See lambda/lex-fulfillment/script.ts for the exact call script.
          </p>
        </>
      )}

      {data.kind === "action" && !FUNCTIONAL_ACTIONS.includes(data.action) && (
        <p className="text-xs text-muted-foreground">
          This action is a logged-only stub: it records that this step ran but does not call an external
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
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {multiline ? (
        <Textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
