"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useAsyncData } from "@/lib/useAsyncData";
import { resolvePatientNames } from "@/lib/resolvePatientNames";
import type { FollowUpCall } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/shadcn/table";

function formatDuration(seconds?: number): string {
  if (seconds === undefined) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export default function DoctorFollowUpCallsPage() {
  const { session } = useAuth();
  const [patientNames, setPatientNames] = useState<Record<string, string>>({});

  const { data: calls, loading, error } = useAsyncData<FollowUpCall[]>(() => {
    if (!session) return null;
    return api.listFollowUpCalls(session.idToken).then(async ({ calls }) => {
      const sorted = calls.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const names = await resolvePatientNames(
        sorted.map((c) => c.patientId).filter((id): id is string => Boolean(id)),
        session.idToken
      );
      setPatientNames(names);
      return sorted;
    });
  }, [session]);

  if (loading) return <LoadingState />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Call history" subtitle="Automated follow-up calls across every appointment" />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!calls || calls.length === 0 ? (
        <EmptyState message="No follow-up calls yet." />
      ) : (
        <Card padding="none">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Patient</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="pr-5">Appointment booked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {calls.map((call) => (
                <TableRow key={call.id}>
                  <TableCell className="pl-5 font-medium">
                    {(call.patientId && patientNames[call.patientId]) ?? call.patientId ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{new Date(call.createdAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <Badge variant={call.status === "failed" ? "neutral" : call.status === "ended" || call.status === "completed" ? "success" : "info"}>
                      {call.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{call.outcome ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDuration(call.duration)}</TableCell>
                  <TableCell className="pr-5">
                    {call.appointmentBooked ? <Badge variant="success">Booked</Badge> : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
