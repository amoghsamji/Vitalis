"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useAsyncData } from "@/lib/useAsyncData";
import type { Slot } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { cardVariants, Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";

export default function DoctorAvailabilityPage() {
  const { session } = useAuth();
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [consultationType, setConsultationType] = useState("video");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [removingKey, setRemovingKey] = useState<string | null>(null);

  const {
    data: slots,
    setData: setSlots,
    loading,
    error: loadError,
  } = useAsyncData<Slot[]>(() => {
    if (!session) return null;
    return api
      .listAvailability(session.sub)
      .then(({ slots }) => slots.slice().sort((a, b) => a.startTime.localeCompare(b.startTime)));
  }, [session]);

  async function addSlot(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !startTime || !endTime) return;
    setSubmitting(true);
    setError(null);
    try {
      const slot = await api.addAvailability(
        session.sub,
        { startTime: new Date(startTime).toISOString(), endTime: new Date(endTime).toISOString(), consultationType },
        session.idToken
      );
      setSlots((prev) => [...(prev ?? []), slot].sort((a, b) => a.startTime.localeCompare(b.startTime)));
      setStartTime("");
      setEndTime("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add slot");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeSlot(slot: Slot) {
    if (!session) return;
    setRemovingKey(slot.startTime);
    setError(null);
    try {
      await api.removeAvailability(session.sub, slot.startTime, session.idToken);
      setSlots((prev) => (prev ?? []).filter((s) => s.startTime !== slot.startTime));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove slot");
    } finally {
      setRemovingKey(null);
    }
  }

  if (loading) return <LoadingState />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Availability" />

      <form onSubmit={addSlot} className={cardVariants({ className: "flex flex-wrap items-end gap-3" })}>
        <div>
          <label className="label">Start time</label>
          <input
            className="input"
            type="datetime-local"
            required
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>
        <div>
          <label className="label">End time</label>
          <input
            className="input"
            type="datetime-local"
            required
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Type</label>
          <select className="input" value={consultationType} onChange={(e) => setConsultationType(e.target.value)}>
            <option value="video">Video</option>
            <option value="chat">Chat</option>
          </select>
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Adding..." : "Add slot"}
        </Button>
      </form>

      {(error || loadError) && <p className="text-sm text-red-600">{error || loadError}</p>}

      <div className="flex flex-col gap-2">
        {!slots || slots.length === 0 ? (
          <EmptyState message="No open slots." />
        ) : (
          slots.map((slot) => (
            <Card key={slot.startTime} padding="sm" className="flex items-center justify-between">
              <span className="text-sm">
                {new Date(slot.startTime).toLocaleString()} &ndash; {new Date(slot.endTime).toLocaleTimeString()} (
                {slot.consultationType})
              </span>
              <Button
                variant="danger"
                size="sm"
                disabled={removingKey === slot.startTime}
                onClick={() => removeSlot(slot)}
              >
                {removingKey === slot.startTime ? "Removing..." : "Remove"}
              </Button>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
