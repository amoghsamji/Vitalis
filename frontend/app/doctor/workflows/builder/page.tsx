"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ReactFlow, {
  Background,
  Controls,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
} from "reactflow";
import "reactflow/dist/style.css";
import { ArrowLeft, Save, History } from "lucide-react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { graphToFlow, flowToGraph, TRIGGER_NODE_ID, type FlowNode, type FlowNodeData } from "@/lib/workflowGraph";
import type { ActionType, ConditionCheck, OutputType, TriggerType, WorkflowRun } from "@/lib/types";
import { nodeTypes } from "@/components/workflow/nodes";
import { NodePalette } from "@/components/workflow/NodePalette";
import { PropertiesPanel } from "@/components/workflow/PropertiesPanel";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/LoadingState";

export default function WorkflowBuilderPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <WorkflowBuilder />
    </Suspense>
  );
}

let nodeIdCounter = 0;
function nextNodeId(kind: string) {
  nodeIdCounter += 1;
  return `${kind}-${Date.now().toString(36)}-${nodeIdCounter}`;
}

function WorkflowBuilder() {
  const rawId = useSearchParams().get("id");
  const isNew = !rawId || rawId === "new";
  const id = isNew ? null : rawId;
  const router = useRouter();
  const { session } = useAuth();

  const [name, setName] = useState("Untitled workflow");
  const [enabled, setEnabled] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[] | null>(null);

  useEffect(() => {
    if (isNew || !session || !id) {
      setLoading(false);
      return;
    }
    api
      .getWorkflow(id, session.idToken)
      .then((wf) => {
        setName(wf.name);
        setEnabled(wf.enabled);
        const flow = graphToFlow(wf);
        setNodes(flow.nodes);
        setEdges(flow.edges);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load workflow"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew, session]);

  const onConnect = useCallback((connection: Connection) => setEdges((eds) => addEdge(connection, eds)), [setEdges]);

  const addNode = (node: FlowNode) => setNodes((nds) => [...nds, node]);
  const nextPosition = () => ({ x: 250 + (nodes.length % 3) * 220, y: 140 + Math.floor(nodes.length / 3) * 150 });

  const hasTrigger = nodes.some((n) => n.id === TRIGGER_NODE_ID);

  function handleAddTrigger(triggerType: TriggerType) {
    addNode({ id: TRIGGER_NODE_ID, type: "trigger", position: { x: 250, y: 0 }, data: { kind: "trigger", triggerType } });
  }
  function handleAddCondition(check: ConditionCheck) {
    addNode({
      id: nextNodeId("condition"),
      type: "condition",
      position: nextPosition(),
      data: { kind: "condition", check, params: {} },
    });
  }
  function handleAddAction(action: ActionType) {
    addNode({
      id: nextNodeId("action"),
      type: "action",
      position: nextPosition(),
      data: { kind: "action", action, params: {} },
    });
  }
  function handleAddOutput(output: OutputType) {
    addNode({
      id: nextNodeId("output"),
      type: "output",
      position: nextPosition(),
      data: { kind: "output", output, params: {} },
    });
  }

  function handleChangeParams(nodeId: string, params: Record<string, string | number>) {
    setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, params } as FlowNodeData } : n)));
  }

  function handleDeleteNode(nodeId: string) {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedNodeId(null);
  }

  async function save() {
    if (!session) return;
    setError(null);
    setMessage(null);
    const { triggerType, graph } = flowToGraph(nodes, edges);
    if (!triggerType) {
      setError("Add a trigger node before saving.");
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        const created = await api.createWorkflow({ name, triggerType, enabled, graph }, session.idToken);
        setMessage("Workflow created.");
        router.replace(`/doctor/workflows/builder?id=${created.id}`);
      } else if (id) {
        await api.updateWorkflow(id, { name, triggerType, enabled, graph }, session.idToken);
        setMessage("Workflow saved.");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function loadRuns() {
    if (!session || !id) return;
    try {
      const { runs } = await api.listWorkflowRuns(id, session.idToken);
      setRuns(runs);
    } catch {
      setRuns([]);
    }
  }

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  if (loading) return <LoadingState message="Loading workflow..." />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={isNew ? "New workflow" : "Edit workflow"}
        actions={
          <Link href="/doctor/workflows" className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
            <ArrowLeft className="h-4 w-4" /> Back to workflows
          </Link>
        }
      />

      <Card className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
        <Button onClick={save} disabled={saving} icon={<Save className="h-4 w-4" />}>
          {saving ? "Saving..." : "Save"}
        </Button>
        {!isNew && (
          <Button variant="secondary" onClick={loadRuns} icon={<History className="h-4 w-4" />}>
            Run history
          </Button>
        )}
        {message && <span className="text-sm text-green-600">{message}</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </Card>

      <div className="flex items-start gap-4">
        <NodePalette
          hasTrigger={hasTrigger}
          onAddTrigger={handleAddTrigger}
          onAddCondition={handleAddCondition}
          onAddAction={handleAddAction}
          onAddOutput={handleAddOutput}
        />

        <div className="h-[600px] flex-1 rounded-lg border border-slate-200 bg-slate-50">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            nodeTypes={nodeTypes}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>

        <PropertiesPanel node={selectedNode} onChangeParams={handleChangeParams} onDelete={handleDeleteNode} />
      </div>

      {runs && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold">Run history</h3>
          {runs.length === 0 ? (
            <p className="text-sm text-slate-500">No runs yet — this workflow hasn&apos;t fired.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {runs.map((run) => (
                <div key={run.runId} className="rounded-md border border-slate-100 p-3 text-sm">
                  <p className="text-xs text-slate-500">{new Date(run.completedAt).toLocaleString()}</p>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {run.auditLog.map((step, i) => (
                      <li key={i} className="text-xs">
                        <span className="font-medium">{step.kind}</span> {step.nodeId} &rarr; {step.outcome}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
