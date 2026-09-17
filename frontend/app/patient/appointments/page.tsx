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
      {(error || cancelError) && <p className="text-sm text-red-600">{error || cancelError}</p>}
      {!appointments || appointments.length === 0 ? (
        <EmptyState message="No appointments yet." cta={{ label: "Find a doctor", href: "/patient/doctors" }} />
      ) : (
        <div className="flex flex-col gap-3">
          {appointments.map((appt) => (
            <Card key={appt.id} className="flex items-center justify-between">
              <div>
                <p className="font-medium">{new Date(appt.startTime).toLocaleString()}</p>
                <p className="text-sm text-slate-500">{appt.consultationType}</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={appt.status === "confirmed" ? "success" : "neutral"}>{appt.status}</Badge>
                {appt.status === "confirmed" && (
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={cancellingId === appt.id}
                    onClick={() => cancel(appt.id)}
                  >
                    {cancellingId === appt.id ? "Cancelling..." : "Cancel"}
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
