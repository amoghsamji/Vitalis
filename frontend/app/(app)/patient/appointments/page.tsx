"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useAsyncData } from "@/lib/useAsyncData";
import type { Appointment } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
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

export default function PatientAppointmentsPage() {
  const { session } = useAuth();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const {
    data: appointments,
    setData: setAppointments,
    loading,
    error,
  } = useAsyncData<Appointment[]>(() => {
    if (!session) return null;
    return api
      .listPatientAppointments(session.sub, session.idToken)
      .then(({ appointments }) => appointments.slice().sort((a, b) => a.startTime.localeCompare(b.startTime)));
  }, [session]);

  async function cancel(id: string) {
    if (!session) return;
    setCancellingId(id);
    setCancelError(null);
    try {
      await api.cancelAppointment(id, session.idToken);
      setAppointments((prev) => prev && prev.map((a) => (a.id === id ? { ...a, status: "cancelled" } : a)));
    } catch (err) {
      setCancelError(err instanceof ApiError ? err.message : "Cancel failed");
    } finally {
      setCancellingId(null);
    }
  }

  if (loading) return <LoadingState />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="My appointments" />
      {(error || cancelError) && <p className="text-sm text-destructive">{error || cancelError}</p>}
      {!appointments || appointments.length === 0 ? (
        <EmptyState message="No appointments yet." cta={{ label: "Find a doctor", href: "/patient/doctors" }} />
      ) : (
        <Card padding="none">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Time</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-5 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {appointments.map((appt) => (
                <TableRow key={appt.id}>
                  <TableCell className="pl-5 font-medium">{new Date(appt.startTime).toLocaleString()}</TableCell>
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
                              This will cancel your appointment on {new Date(appt.startTime).toLocaleString()}.
                              This can&apos;t be undone.
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
