"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { resolvePatientNames } from "@/lib/resolvePatientNames";
import type { Appointment, FollowUpCall, FollowUpCallEvent, PrescriptionMedicationItem } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/shadcn/input";
import { Textarea } from "@/components/ui/shadcn/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/shadcn/dialog";
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
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [uploadedIds, setUploadedIds] = useState<Record<string, boolean>>({});
  const [issuedIds, setIssuedIds] = useState<Record<string, boolean>>({});

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

  async function markCompleted(id: string) {
    if (!session) return;
    setCompletingId(id);
    setError(null);
    try {
      await api.markAppointmentCompleted(id, session.idToken);
      setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, status: "completed" } : a)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to mark completed");
    } finally {
      setCompletingId(null);
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
                    <Badge
                      variant={
                        appt.status === "confirmed" ? "success" : appt.status === "completed" ? "info" : "neutral"
                      }
                    >
                      {appt.status}
                    </Badge>
                    {uploadedIds[appt.id] && (
                      <Badge variant="success" className="ml-1.5">
                        Prescription uploaded
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <div className="flex flex-col items-end gap-2">
                      {appt.status === "confirmed" && (
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={completingId === appt.id}
                            onClick={() => markCompleted(appt.id)}
                          >
                            {completingId === appt.id ? "Marking..." : "Mark completed"}
                          </Button>
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
                                <AlertDialogAction onClick={() => cancel(appt.id)}>
                                  Cancel appointment
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      )}
                      {appt.status === "completed" && (
                        <>
                          {!issuedIds[appt.id] ? (
                            <IssuePrescriptionModal
                              appointmentId={appt.id}
                              onIssued={() => setIssuedIds((prev) => ({ ...prev, [appt.id]: true }))}
                            />
                          ) : (
                            <Badge variant="success">Prescription issued</Badge>
                          )}
                          {!uploadedIds[appt.id] ? (
                            <PrescriptionUpload
                              appointmentId={appt.id}
                              onUploaded={() => setUploadedIds((prev) => ({ ...prev, [appt.id]: true }))}
                            />
                          ) : (
                            <FollowUpCallPanel appointmentId={appt.id} patientId={appt.patientId} />
                          )}
                        </>
                      )}
                    </div>
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

function maskPhone(phone: string): string {
  if (phone.length <= 7) return phone;
  return `${phone.slice(0, 3)}${"*".repeat(phone.length - 7)}${phone.slice(-4)}`;
}

function FollowUpCallPanel({ appointmentId, patientId }: { appointmentId: string; patientId: string }) {
  const { session } = useAuth();
  const [call, setCall] = useState<FollowUpCall | null>(null);
  const [events, setEvents] = useState<FollowUpCallEvent[]>([]);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [patientPhone, setPatientPhone] = useState<string | null>(null);

  async function refresh() {
    if (!session) return;
    const { call, events } = await api.getFollowUpCall(appointmentId, session.idToken);
    setCall(call);
    setEvents(events);
  }

  useEffect(() => {
    refresh();
    if (session) {
      api
        .getPatient(patientId, session.idToken)
        .then((p) => setPatientPhone(p.phone || null))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, appointmentId]);

  async function start() {
    if (!session) return;
    setStarting(true);
    setMessage(null);
    try {
      const result = await api.startFollowUpCall(appointmentId, session.idToken);
      setMessage(result.alreadyRequested ? "A follow-up call was already requested." : "Follow-up call started.");
      await refresh();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to start follow-up call");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex w-full max-w-xs flex-col items-end gap-1.5 text-xs">
      {patientPhone && <span className="text-muted-foreground">Phone: {maskPhone(patientPhone)}</span>}
      <span className="text-muted-foreground">Prescription: Uploaded</span>
      {call ? (
        <>
          <Badge variant={call.status === "failed" ? "neutral" : "info"}>Follow-up call: {call.status}</Badge>
          {call.outcome && <span className="text-muted-foreground">Outcome: {call.outcome}</span>}
          {call.appointmentBooked && <Badge variant="success">Appointment booked</Badge>}
          {events.length > 0 && (
            <ul className="w-full list-none text-right text-[11px] text-muted-foreground">
              {events
                .slice()
                .reverse()
                .slice(0, 5)
                .map((e, i) => (
                  <li key={i}>
                    {e.event} &mdash; {new Date(e.timestamp).toLocaleString()}
                  </li>
                ))}
            </ul>
          )}
        </>
      ) : (
        <Button variant="secondary" size="sm" onClick={start} disabled={starting}>
          {starting ? "Starting..." : "Start follow-up call"}
        </Button>
      )}
      {message && <span className="text-muted-foreground">{message}</span>}
    </div>
  );
}

function PrescriptionUpload({ appointmentId, onUploaded }: { appointmentId: string; onUploaded: () => void }) {
  const { session } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [followUpSummary, setFollowUpSummary] = useState("");
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!session || !file) return;
    setUploading(true);
    setStatus(null);
    try {
      const { uploadUrl, key } = await api.presignPrescription(appointmentId, session.idToken);
      await api.uploadFile(uploadUrl, file);
      await api.confirmPrescription({ appointmentId, key, followUpSummary }, session.idToken);
      onUploaded();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex w-full max-w-xs flex-col items-end gap-1.5">
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        className="w-full text-xs text-muted-foreground file:mr-2 file:rounded-md file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs file:font-medium file:text-secondary-foreground"
      />
      <input
        type="text"
        placeholder="Follow-up summary"
        value={followUpSummary}
        onChange={(e) => setFollowUpSummary(e.target.value)}
        className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs"
      />
      <Button size="sm" onClick={upload} disabled={uploading}>
        {uploading ? "Uploading..." : "Upload prescription"}
      </Button>
      {status && <span className="text-xs text-destructive">{status}</span>}
    </div>
  );
}

const emptyMedication: PrescriptionMedicationItem = { name: "", dosage: "", frequency: "", duration: "", instructions: "" };

function IssuePrescriptionModal({ appointmentId, onIssued }: { appointmentId: string; onIssued: () => void }) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [diagnosis, setDiagnosis] = useState("");
  const [notes, setNotes] = useState("");
  const [medications, setMedications] = useState<PrescriptionMedicationItem[]>([{ ...emptyMedication }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateMedication(index: number, field: keyof PrescriptionMedicationItem, value: string) {
    setMedications((prev) => prev.map((m, i) => (i === index ? { ...m, [field]: value } : m)));
  }

  function addMedication() {
    setMedications((prev) => [...prev, { ...emptyMedication }]);
  }

  function removeMedication(index: number) {
    setMedications((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit() {
    if (!session) return;
    const cleaned = medications
      .map((m) => ({ ...m, name: m.name.trim(), dosage: m.dosage.trim(), frequency: m.frequency.trim() }))
      .filter((m) => m.name && m.dosage && m.frequency);
    if (cleaned.length === 0) {
      setError("Add at least one medication with a name, dosage, and frequency.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.issuePrescription(
        { appointmentId, diagnosis: diagnosis.trim() || undefined, notes: notes.trim() || undefined, medications: cleaned },
        session.idToken
      );
      onIssued();
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to issue prescription");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Issue prescription</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Issue prescription</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-left">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Diagnosis</label>
            <Input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="e.g. Acute sinusitis" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Medications</label>
            {medications.map((med, i) => (
              <div key={i} className="flex flex-col gap-1.5 rounded-md border border-border p-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Name" value={med.name} onChange={(e) => updateMedication(i, "name", e.target.value)} />
                  <Input
                    placeholder="Dosage (e.g. 500mg)"
                    value={med.dosage}
                    onChange={(e) => updateMedication(i, "dosage", e.target.value)}
                  />
                  <Input
                    placeholder="Frequency (e.g. twice daily)"
                    value={med.frequency}
                    onChange={(e) => updateMedication(i, "frequency", e.target.value)}
                  />
                  <Input
                    placeholder="Duration (e.g. 7 days)"
                    value={med.duration}
                    onChange={(e) => updateMedication(i, "duration", e.target.value)}
                  />
                </div>
                <Input
                  placeholder="Instructions (e.g. take with food)"
                  value={med.instructions}
                  onChange={(e) => updateMedication(i, "instructions", e.target.value)}
                />
                {medications.length > 1 && (
                  <Button variant="ghost" size="sm" className="self-end" onClick={() => removeMedication(i)}>
                    Remove
                  </Button>
                )}
              </div>
            ))}
            <Button variant="secondary" size="sm" className="self-start" onClick={addMedication}>
              Add medication
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Notes for patient</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Issuing..." : "Issue prescription"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
