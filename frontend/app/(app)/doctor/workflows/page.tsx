"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useAsyncData } from "@/lib/useAsyncData";
import type { Workflow } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonVariants } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { TRIGGER_LABELS } from "@/components/workflow/labels";

export default function WorkflowsPage() {
  const { session } = useAuth();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    data: workflows,
    setData: setWorkflows,
    loading,
    error: loadError,
  } = useAsyncData<Workflow[]>(() => {
    if (!session) return null;
    return api.listWorkflows(session.idToken).then(({ workflows }) => workflows);
  }, [session]);

  async function remove(id: string) {
    if (!session) return;
    setDeletingId(id);
    setError(null);
    try {
      await api.deleteWorkflow(id, session.idToken);
      setWorkflows((prev) => prev && prev.filter((w) => w.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete workflow");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <LoadingState message="Loading workflows..." />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Workflows"
        subtitle="Automate follow-ups — e.g. text a patient automatically when a lab result needs attention."
        actions={
          <Link href="/doctor/workflows/builder?id=new" className={buttonVariants({ variant: "primary" })}>
            <Plus className="h-4 w-4" /> New workflow
          </Link>
        }
      />
      {(error || loadError) && <p className="text-sm text-destructive">{error || loadError}</p>}

      {!workflows || workflows.length === 0 ? (
        <EmptyState
          message="No workflows yet."
          cta={{ label: "Build your first workflow", href: "/doctor/workflows/builder?id=new" }}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {workflows.map((wf) => (
            <Card key={wf.id} className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Link href={`/doctor/workflows/builder?id=${wf.id}`} className="font-medium hover:text-primary">
                    {wf.name}
                  </Link>
                  <Badge variant={wf.enabled ? "success" : "neutral"}>{wf.enabled ? "Enabled" : "Disabled"}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{TRIGGER_LABELS[wf.triggerType] ?? wf.triggerType}</p>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/doctor/workflows/builder?id=${wf.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                  Edit
                </Link>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={deletingId === wf.id}
                  onClick={() => remove(wf.id)}
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                >
                  {deletingId === wf.id ? "Deleting..." : "Delete"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
