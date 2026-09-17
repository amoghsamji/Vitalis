"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { resolvePatientNames } from "@/lib/resolvePatientNames";
import type { Appointment } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";

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
      {error && <p className="text-sm text-red-600">{error}</p>}
      {appointments.length === 0 ? (
        <EmptyState message="No appointments yet." />
      ) : (
        <div className="flex flex-col gap-3">
          {appointments.map((appt) => (
            <Card key={appt.id} className="flex items-center justify-between">
              <div>
                <p className="font-medium">{patientNames[appt.patientId] ?? appt.patientId}</p>
                <p className="text-sm text-slate-500">
                  {new Date(appt.startTime).toLocaleString()} &middot; {appt.consultationType}
                </p>
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
