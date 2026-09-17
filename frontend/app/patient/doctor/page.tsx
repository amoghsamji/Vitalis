"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Doctor, Slot } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";

export default function DoctorDetailPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <DoctorDetail />
    </Suspense>
  );
}

function DoctorDetail() {
  const id = useSearchParams().get("id");
  const { session } = useAuth();
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([api.getDoctor(id), api.listAvailability(id)])
      .then(([doctor, { slots }]) => {
        setDoctor(doctor);
        setSlots(slots.slice().sort((a, b) => a.startTime.localeCompare(b.startTime)));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load doctor"))
      .finally(() => setLoading(false));
  }, [id]);

  async function book(slot: Slot) {
    if (!id || !session) return;
    setBookingId(slot.startTime);
    setError(null);
    setMessage(null);
    try {
      await api.bookAppointment(
        { doctorId: id, patientId: session.sub, slotStartTime: slot.startTime, consultationType: slot.consultationType },
        session.idToken
      );
      setSlots((prev) => prev.filter((s) => s.startTime !== slot.startTime));
      setMessage("Appointment booked!");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Booking failed");
    } finally {
      setBookingId(null);
    }
  }

  if (!id) return <p className="text-slate-500">No doctor selected.</p>;
  if (loading) return <LoadingState />;
  if (!doctor) return <p className="text-red-600">{error || "Doctor not found"}</p>;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <h1 className="text-2xl font-semibold">{doctor.name}</h1>
        <p className="text-slate-600">{doctor.specialty}</p>
        <p className="mt-2 text-sm text-slate-500">{doctor.bio}</p>
        <p className="mt-2 text-xs text-slate-400">Languages: {doctor.languages.join(", ") || "-"}</p>
      </Card>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Available slots</h2>
        {message && <p className="mb-3 text-sm text-green-600">{message}</p>}
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        {slots.length === 0 ? (
          <EmptyState message="No open slots right now." />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {slots.map((slot) => (
              <Card key={slot.startTime} padding="sm" className="flex items-center justify-between">
                <span className="text-sm">{new Date(slot.startTime).toLocaleString()}</span>
                <Button disabled={bookingId === slot.startTime} onClick={() => book(slot)}>
                  {bookingId === slot.startTime ? "Booking..." : "Book"}
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
