"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useAsyncData } from "@/lib/useAsyncData";
import type { Prescription, PrescriptionMedicationItem, TranslatedPrescription } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/shadcn/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/shadcn/select";

const LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "hi", label: "Hindi" },
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function printPrescription(rx: Prescription, translated: TranslatedPrescription | null) {
  const win = window.open("", "_blank", "width=650,height=820");
  if (!win) return;

  const diagnosis = translated?.diagnosis ?? rx.diagnosis;
  const notes = translated?.notes ?? rx.notes;
  const medications = translated?.medications ?? rx.medications ?? [];
  const issued = rx.issuedAt ? new Date(rx.issuedAt).toLocaleString() : "";

  const rows = medications
    .map(
      (m) =>
        `<tr><td>${escapeHtml(m.name)}</td><td>${escapeHtml(m.dosage)}</td><td>${escapeHtml(m.frequency)}</td><td>${escapeHtml(m.duration || "-")}</td><td>${escapeHtml(m.instructions || "-")}</td></tr>`
    )
    .join("");

  win.document.write(`<!DOCTYPE html><html><head><title>Prescription</title>
    <style>
      body { font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 32px; color: #111; }
      h1 { font-size: 20px; margin-bottom: 4px; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      td, th { border: 1px solid #ccc; padding: 6px 8px; text-align: left; font-size: 13px; }
      .meta { color: #666; font-size: 12px; margin-top: 24px; }
    </style>
    </head><body>
    <h1>Prescription</h1>
    ${diagnosis ? `<p><strong>Diagnosis:</strong> ${escapeHtml(diagnosis)}</p>` : ""}
    <table><thead><tr><th>Medication</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead>
    <tbody>${rows}</tbody></table>
    ${notes ? `<p><strong>Notes:</strong> ${escapeHtml(notes)}</p>` : ""}
    <p class="meta">Issued ${escapeHtml(issued)}</p>
    </body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

export default function PatientPrescriptionsPage() {
  const { session } = useAuth();

  const {
    data: prescriptions,
    loading,
    error,
  } = useAsyncData<Prescription[]>(() => {
    if (!session) return null;
    return api.listPatientPrescriptions(session.sub, session.idToken).then((r) => r.prescriptions);
  }, [session]);

  if (loading) return <LoadingState />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Prescriptions" />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!prescriptions || prescriptions.length === 0 ? (
        <EmptyState message="No prescriptions yet." />
      ) : (
        <div className="flex flex-col gap-3">
          {prescriptions.map((rx) => (
            <PrescriptionCard key={rx.id} prescription={rx} />
          ))}
        </div>
      )}
    </div>
  );
}

function PrescriptionCard({ prescription }: { prescription: Prescription }) {
  const { session } = useAuth();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const issuedLabel = prescription.type === "digital" ? prescription.issuedAt : prescription.uploadedAt;

  async function download() {
    if (!session) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const { downloadUrl } = await api.getPrescriptionDownloadUrl(prescription.id, session.idToken);
      window.open(downloadUrl, "_blank");
    } catch (err) {
      setDownloadError(err instanceof ApiError ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant={prescription.type === "digital" ? "info" : "neutral"}>
              {prescription.type === "digital" ? "Digital Rx" : "PDF Rx"}
            </Badge>
            {issuedLabel && (
              <span className="text-xs text-muted-foreground">{new Date(issuedLabel).toLocaleString()}</span>
            )}
          </div>
          {prescription.type === "digital" && prescription.diagnosis && (
            <p className="mt-1.5 text-sm font-medium text-foreground">{prescription.diagnosis}</p>
          )}
          {prescription.type === "digital" && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {(prescription.medications || []).map((m) => m.name).join(", ") || "No medications listed"}
            </p>
          )}
          {prescription.type === "pdf" && prescription.followUpSummary && (
            <p className="mt-1.5 text-sm text-muted-foreground">{prescription.followUpSummary}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {prescription.type === "digital" ? (
            <RxDetailModal prescription={prescription} />
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={download} disabled={downloading}>
                {downloading ? "Preparing..." : "Download PDF"}
              </Button>
              {downloadError && <span className="text-xs text-destructive">{downloadError}</span>}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

function RxDetailModal({ prescription }: { prescription: Prescription }) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState("en");
  const [translated, setTranslated] = useState<TranslatedPrescription | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [generatingAudio, setGeneratingAudio] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  async function changeLanguage(code: string) {
    setLanguage(code);
    setAudioUrl(null);
    setAudioError(null);
    if (!session || code === "en") {
      setTranslated(null);
      return;
    }
    setTranslating(true);
    setTranslateError(null);
    try {
      const result = await api.translatePrescription(prescription.id, code, session.idToken);
      setTranslated(result);
    } catch (err) {
      setTranslateError(err instanceof ApiError ? err.message : "Translation failed");
    } finally {
      setTranslating(false);
    }
  }

  async function playAudio() {
    if (!session) return;
    setGeneratingAudio(true);
    setAudioError(null);
    try {
      const { audioUrl } = await api.getPrescriptionAudio(prescription.id, language, session.idToken);
      setAudioUrl(audioUrl);
    } catch (err) {
      setAudioError(err instanceof ApiError ? err.message : "Couldn't generate audio");
    } finally {
      setGeneratingAudio(false);
    }
  }

  const diagnosis = translated?.diagnosis ?? prescription.diagnosis;
  const notes = translated?.notes ?? prescription.notes;
  const medications: PrescriptionMedicationItem[] = translated?.medications ?? prescription.medications ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">View prescription</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Prescription</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-left">
          <div className="flex items-center gap-2">
            <Select value={language} onValueChange={changeLanguage}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.code} value={l.code}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="secondary" size="sm" onClick={playAudio} disabled={generatingAudio}>
              {generatingAudio ? "Generating..." : "Listen"}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => printPrescription(prescription, translated)}>
              Print / Download
            </Button>
          </div>
          {translating && <p className="text-xs text-muted-foreground">Translating...</p>}
          {translateError && <p className="text-xs text-destructive">{translateError}</p>}
          {audioError && <p className="text-xs text-destructive">{audioError}</p>}
          {audioUrl && <audio controls autoPlay src={audioUrl} className="w-full" />}

          {diagnosis && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Diagnosis</p>
              <p className="text-sm text-foreground">{diagnosis}</p>
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-muted-foreground">Medications</p>
            <ul className="mt-1 flex flex-col gap-1.5">
              {medications.map((m, i) => (
                <li key={i} className="rounded-md border border-border p-2 text-sm">
                  <span className="font-medium">{m.name}</span> — {m.dosage}, {m.frequency}
                  {m.duration ? `, for ${m.duration}` : ""}
                  {m.instructions && <div className="text-xs text-muted-foreground">{m.instructions}</div>}
                </li>
              ))}
            </ul>
          </div>

          {notes && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Notes</p>
              <p className="text-sm text-foreground">{notes}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
