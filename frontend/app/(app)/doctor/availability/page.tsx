"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useAsyncData } from "@/lib/useAsyncData";
import type { Slot } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/shadcn/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/shadcn/table";

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

      <Card>
        <form onSubmit={addSlot} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="startTime">Start time</Label>
            <Input
              id="startTime"
              type="datetime-local"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="endTime">End time</Label>
            <Input
              id="endTime"
              type="datetime-local"
              required
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Type</Label>
            <Select value={consultationType} onValueChange={setConsultationType}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="video">Video</SelectItem>
                <SelectItem value="chat">Chat</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Adding..." : "Add slot"}
          </Button>
        </form>
      </Card>

      {(error || loadError) && <p className="text-sm text-destructive">{error || loadError}</p>}

      {!slots || slots.length === 0 ? (
        <EmptyState message="No open slots." />
      ) : (
        <Card padding="none">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="pr-5 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slots.map((slot) => (
                <TableRow key={slot.startTime}>
                  <TableCell className="pl-5 font-medium">{new Date(slot.startTime).toLocaleString()}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(slot.endTime).toLocaleTimeString()}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{slot.consultationType}</TableCell>
                  <TableCell className="pr-5 text-right">
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={removingKey === slot.startTime}
                      onClick={() => removeSlot(slot)}
                    >
                      {removingKey === slot.startTime ? "Removing..." : "Remove"}
                    </Button>
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
