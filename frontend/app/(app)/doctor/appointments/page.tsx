"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { resolvePatientNames } from "@/lib/resolvePatientNames";
import type { Appointment } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/shadcn/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/shadcn/alert-dialog";

export default function DoctorAppointmentsPage() {
  const { session } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patientNames, setPatientNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    api
      .listDoctorAppointments(session.sub, session.idToken)
      .then(async ({ appointments }) => {
        const sorted = appointments.slice().sort((a, b) => a.startTime.localeCompare(b.startTime));
        setAppointments(sorted);
        const names = await resolvePatientNames(
          sorted.map((a) => a.patientId),
          session.idToken
        );
        setPatientNames(names);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load appointments"))
      .finally(() => setLoading(false));
  }, [session]);

  async function cancel(id: string) {
    if (!session) return;
    setCancellingId(id);
    setError(null);
    try {
      await api.cancelAppointment(id, session.idToken);
      setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, status: "cancelled" } : a)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Cancel failed");
    } finally {
      setCancellingId(null);
    }
  }

  if (loading) return <LoadingState />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Appointments" />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {appointments.length === 0 ? (
        <EmptyState message="No appointments yet." />
      ) : (
        <Card padding="none">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Patient</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-5 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {appointments.map((appt) => (
                <TableRow key={appt.id}>
                  <TableCell className="pl-5 font-medium">
                    {patientNames[appt.patientId] ?? appt.patientId}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(appt.startTime).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{appt.consultationType}</TableCell>
                  <TableCell>
                    <Badge variant={appt.status === "confirmed" ? "success" : "neutral"}>{appt.status}</Badge>
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    {appt.status === "confirmed" && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="danger" size="sm" disabled={cancellingId === appt.id}>
                            {cancellingId === appt.id ? "Cancelling..." : "Cancel"}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Cancel this appointment?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will cancel the appointment with{" "}
                              {patientNames[appt.patientId] ?? appt.patientId} on{" "}
                              {new Date(appt.startTime).toLocaleString()}. This can&apos;t be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Keep it</AlertDialogCancel>
                            <AlertDialogAction onClick={() => cancel(appt.id)}>Cancel appointment</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
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
