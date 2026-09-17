import type { Edge, Node } from "reactflow";
import type {
  ActionType,
  ConditionCheck,
  OutputType,
  TriggerType,
  Workflow,
  WorkflowGraph,
  WorkflowNode,
} from "./types";

// The backend graph is a linked list of nodes with explicit next/onTrue/onFalse
// pointers (see lambda/workflow-engine/index.ts) — not a React Flow-native
// nodes[]+edges[] array, and the trigger isn't a node in it at all (it's the
// top-level triggerType field). This file translates both directions.

export const TRIGGER_NODE_ID = "trigger";

export type FlowNodeData =
  | { kind: "trigger"; triggerType: TriggerType }
  | { kind: "condition"; check: ConditionCheck; params: Record<string, string | number> }
  | { kind: "action"; action: ActionType; params: Record<string, string | number> }
  | { kind: "output"; output: OutputType; params: Record<string, string | number> };

export type FlowNode = Node<FlowNodeData>;

const DEFAULT_TRIGGER_POSITION = { x: 250, y: 0 };

export function graphToFlow(workflow: Pick<Workflow, "triggerType" | "graph">): { nodes: FlowNode[]; edges: Edge[] } {
  const storedNodes = workflow.graph?.nodes ?? [];
  const startNodeId = workflow.graph?.startNodeId ?? null;

  const positions = fillMissingPositions(storedNodes, startNodeId);

  const nodes: FlowNode[] = [
    {
      id: TRIGGER_NODE_ID,
      type: "trigger",
      position: DEFAULT_TRIGGER_POSITION,
      data: { kind: "trigger", triggerType: workflow.triggerType },
    },
    ...storedNodes.map((n) => storedNodeToFlowNode(n, positions.get(n.id)!)),
  ];

  const edges: Edge[] = [];
  if (startNodeId) {
    edges.push({ id: `${TRIGGER_NODE_ID}->${startNodeId}`, source: TRIGGER_NODE_ID, target: startNodeId });
  }
  for (const n of storedNodes) {
    if (n.kind === "condition") {
      if (n.onTrue) edges.push({ id: `${n.id}-true`, source: n.id, target: n.onTrue, sourceHandle: "true", label: "True" });
      if (n.onFalse) edges.push({ id: `${n.id}-false`, source: n.id, target: n.onFalse, sourceHandle: "false", label: "False" });
    } else if (n.next) {
      edges.push({ id: `${n.id}-next`, source: n.id, target: n.next });
    }
  }

  return { nodes, edges };
}

export function flowToGraph(nodes: FlowNode[], edges: Edge[]): { triggerType: TriggerType | undefined; graph: WorkflowGraph } {
  const trigger = nodes.find((n) => n.data.kind === "trigger");
  const triggerType = trigger && trigger.data.kind === "trigger" ? trigger.data.triggerType : undefined;

  const startEdge = edges.find((e) => e.source === TRIGGER_NODE_ID);
  const startNodeId = startEdge?.target ?? null;

  const graphNodes: WorkflowNode[] = nodes
    .filter((n) => n.data.kind !== "trigger")
    .map((n) => flowNodeToStoredNode(n, edges));

  return { triggerType, graph: { startNodeId, nodes: graphNodes } };
}

function storedNodeToFlowNode(n: WorkflowNode, position: { x: number; y: number }): FlowNode {
  if (n.kind === "condition") {
    return { id: n.id, type: "condition", position, data: { kind: "condition", check: n.check, params: n.params } };
  }
  if (n.kind === "action") {
    return { id: n.id, type: "action", position, data: { kind: "action", action: n.action, params: n.params } };
  }
  return { id: n.id, type: "output", position, data: { kind: "output", output: n.output, params: n.params } };
}

function flowNodeToStoredNode(n: FlowNode, edges: Edge[]): WorkflowNode {
  const position = { x: n.position.x, y: n.position.y };
  if (n.data.kind === "condition") {
    const onTrue = edges.find((e) => e.source === n.id && e.sourceHandle === "true")?.target ?? null;
    const onFalse = edges.find((e) => e.source === n.id && e.sourceHandle === "false")?.target ?? null;
    return { id: n.id, kind: "condition", check: n.data.check, params: n.data.params, onTrue, onFalse, position };
  }
  const next = edges.find((e) => e.source === n.id)?.target ?? null;
  if (n.data.kind === "action") {
    return { id: n.id, kind: "action", action: n.data.action, params: n.data.params, next, position };
  }
  // n.data.kind === "output" (the only remaining case — "trigger" nodes are filtered
  // out by the caller before this function is ever called)
  if (n.data.kind === "output") {
    return { id: n.id, kind: "output", output: n.data.output, params: n.data.params, next, position };
  }
  throw new Error(`Unexpected node kind for a non-trigger node: ${n.data.kind}`);
}

/** BFS layout fallback for nodes with no saved position (e.g. the handwritten sample workflow). */
function fillMissingPositions(nodes: WorkflowNode[], startNodeId: string | null): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const columnCountByDepth = new Map<number, number>();

  const visit = (id: string | null, depth: number) => {
    if (!id || positions.has(id)) return;
    const node = byId.get(id);
    if (!node) return;

    if (node.position) {
      positions.set(id, node.position);
    } else {
      const column = columnCountByDepth.get(depth) ?? 0;
      columnCountByDepth.set(depth, column + 1);
      positions.set(id, { x: 250 + column * 280, y: 120 + depth * 150 });
    }

    if (node.kind === "condition") {
      visit(node.onTrue, depth + 1);
      visit(node.onFalse, depth + 1);
    } else {
      visit(node.next, depth + 1);
    }
  };

  visit(startNodeId, 0);
  // Any node unreachable from startNodeId (shouldn't normally happen) still needs a position.
  for (const n of nodes) {
    if (!positions.has(n.id)) visit(n.id, 0);
  }

  return positions;
}
