"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Condition, Medication, Patient } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/LoadingState";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/shadcn/tabs";
import { PHONE_E164_REGEX, computeFollowUpEnabled } from "@/lib/constants";

const blankPatient = (id: string, email: string): Patient => ({
  id,
  name: "",
  dob: "",
  insurance: "",
  mrn: "",
  riskLevel: "unknown",
  phone: "",
  email,
  followUpCallsEnabled: false,
  consentTimestamp: null,
  consentVersion: null,
});

export default function PatientProfilePage() {
  const { session } = useAuth();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consentGiven, setConsentGiven] = useState(false);
  const [enableFollowUp, setEnableFollowUp] = useState(false);
  const [followUpError, setFollowUpError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        const p = await api.getPatient(session.sub, session.idToken);
        setPatient(p);
        setEnableFollowUp(Boolean(p.followUpCallsEnabled));
        setConsentGiven(Boolean(p.followUpCallsEnabled));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setPatient(blankPatient(session.sub, session.email));
        } else {
          setError(err instanceof Error ? err.message : "Failed to load profile");
        }
      }
      const [{ conditions }, { medications }] = await Promise.all([
        api.listConditions(session.sub, session.idToken),
        api.listMedications(session.sub, session.idToken),
      ]);
      setConditions(conditions);
      setMedications(medications);
      setLoading(false);
    })();
  }, [session]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !patient) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    setFollowUpError(null);

    if (enableFollowUp && !computeFollowUpEnabled(patient.phone, consentGiven)) {
      setFollowUpError(
        !PHONE_E164_REGEX.test(patient.phone)
          ? "Enter a valid phone number in E.164 format before enabling follow-up calls."
          : "You must agree to the consent checkbox to enable follow-up calls."
      );
      setSaving(false);
      return;
    }

    try {
      const followUpCallsEnabled = computeFollowUpEnabled(patient.phone, consentGiven) && enableFollowUp;
      const saved = await api.updatePatient(
        session.sub,
        { ...patient, followUpCallsEnabled, consentGiven } as Partial<Patient> & { consentGiven: boolean },
        session.idToken
      );
      setPatient(saved);
      setEnableFollowUp(Boolean(saved.followUpCallsEnabled));
      setMessage("Profile saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !patient) return <LoadingState />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="My profile" />

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="conditions">Conditions</TabsTrigger>
          <TabsTrigger value="medications">Medications</TabsTrigger>
          <TabsTrigger value="upload">Upload</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardContent className="pt-5">
              <form onSubmit={saveProfile} className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" value={patient.name} onChange={(v) => setPatient({ ...patient, name: v })} />
                <Field
                  label="Date of birth"
                  type="date"
                  value={patient.dob}
                  onChange={(v) => setPatient({ ...patient, dob: v })}
                />
                <div className="flex flex-col gap-1.5">
                  <Field label="Phone" value={patient.phone} onChange={(v) => setPatient({ ...patient, phone: v })} />
                  <p className="text-xs text-muted-foreground">
                    Enter your mobile number with country code, without spaces or dashes. Example: +919876543210.
                  </p>
                </div>
                <Field label="Email" value={patient.email} onChange={(v) => setPatient({ ...patient, email: v })} />
                <Field
                  label="Insurance"
                  value={patient.insurance ?? ""}
                  onChange={(v) => setPatient({ ...patient, insurance: v })}
                />
                <Field label="MRN" value={patient.mrn ?? ""} onChange={(v) => setPatient({ ...patient, mrn: v })} />

                <div className="flex flex-col gap-2 sm:col-span-2 rounded-md border border-border p-3">
                  <p className="text-xs text-muted-foreground">
                    After a completed appointment where your doctor uploads a prescription, Vitalis can place an
                    automated phone call a few days later to check how you&apos;re feeling. The call is placed by an
                    automated system (Amazon Connect + a voice bot) — it identifies itself, confirms it&apos;s
                    talking to you by first name, and never discusses your health information if it can&apos;t
                    verify you. You can ask it to schedule a follow-up appointment, or say you&apos;re fine. You can
                    turn this off at any time, and no more calls will be placed once you do.
                  </p>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={consentGiven}
                      onChange={(e) => setConsentGiven(e.target.checked)}
                    />
                    I agree to receive automated healthcare follow-up calls on this number.
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={enableFollowUp}
                      disabled={!computeFollowUpEnabled(patient.phone, consentGiven)}
                      onChange={(e) => setEnableFollowUp(e.target.checked)}
                    />
                    Enable automated follow-up calls
                  </label>
                  {followUpError && <span className="text-sm text-destructive">{followUpError}</span>}
                  {patient.followUpCallsEnabled && (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      className="w-fit"
                      disabled={saving}
                      onClick={async () => {
                        if (!session) return;
                        setSaving(true);
                        setMessage(null);
                        setError(null);
                        try {
                          const saved = await api.updatePatient(
                            session.sub,
                            { ...patient, followUpCallsEnabled: false, consentGiven: false } as Partial<Patient> & {
                              consentGiven: boolean;
                            },
                            session.idToken
                          );
                          setPatient(saved);
                          setEnableFollowUp(false);
                          setConsentGiven(false);
                          setMessage("Automated follow-up calls stopped. No more calls will be placed.");
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Failed to stop calls");
                        } finally {
                          setSaving(false);
                        }
                      }}
                    >
                      Stop automated calls now
                    </Button>
                  )}
                </div>

                <div className="flex items-center gap-3 sm:col-span-2">
                  <Button type="submit" disabled={saving}>
                    {saving ? "Saving..." : "Save profile"}
                  </Button>
                  {message && <span className="text-sm text-emerald-600">{message}</span>}
                  {error && <span className="text-sm text-destructive">{error}</span>}
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conditions">
          <ConditionsSection conditions={conditions} onAdd={(c) => setConditions((prev) => [...prev, c])} />
        </TabsContent>

        <TabsContent value="medications">
          <MedicationsSection medications={medications} onAdd={(m) => setMedications((prev) => [...prev, m])} />
        </TabsContent>

        <TabsContent value="upload">
          <UploadSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ConditionsSection({ conditions, onAdd }: { conditions: Condition[]; onAdd: (c: Condition) => void }) {
  const { session } = useAuth();
  const [icd10Code, setIcd10Code] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !icd10Code || !description) return;
    setSubmitting(true);
    try {
      const condition = await api.addCondition(session.sub, { icd10Code, description }, session.idToken);
      onAdd(condition);
      setIcd10Code("");
      setDescription("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5">
        {conditions.map((c) => (
          <div key={c.id} className="flex justify-between text-sm">
            <span>
              {c.icd10Code} &mdash; {c.description}
            </span>
          </div>
        ))}
        {conditions.length === 0 && <p className="text-sm text-muted-foreground">No conditions recorded.</p>}
        <form onSubmit={add} className="flex gap-2 border-t border-border pt-3">
          <Input placeholder="ICD-10 code" value={icd10Code} onChange={(e) => setIcd10Code(e.target.value)} />
          <Input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <Button variant="secondary" type="submit" disabled={submitting}>
            Add
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function MedicationsSection({ medications, onAdd }: { medications: Medication[]; onAdd: (m: Medication) => void }) {
  const { session } = useAuth();
  const [name, setName] = useState("");
  const [dosage, setDosage] = useState("");
  const [frequency, setFrequency] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !name) return;
    setSubmitting(true);
    try {
      const medication = await api.addMedication(
        session.sub,
        { name, dosage, frequency, prescriber: "" },
        session.idToken
      );
      onAdd(medication);
      setName("");
      setDosage("");
      setFrequency("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5">
        {medications.map((m) => (
          <div key={m.id} className="flex justify-between text-sm">
            <span>
              {m.name} &mdash; {m.dosage} {m.frequency}
            </span>
          </div>
        ))}
        {medications.length === 0 && <p className="text-sm text-muted-foreground">No medications recorded.</p>}
        <form onSubmit={add} className="flex gap-2 border-t border-border pt-3">
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Dosage" value={dosage} onChange={(e) => setDosage(e.target.value)} />
          <Input placeholder="Frequency" value={frequency} onChange={(e) => setFrequency(e.target.value)} />
          <Button variant="secondary" type="submit" disabled={submitting}>
            Add
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function UploadSection() {
  const { session } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!session || !file) return;
    setUploading(true);
    setStatus(null);
    try {
      const { uploadUrl } = await api.getUploadUrl(file.name, file.type || "application/pdf", session.idToken);
      await api.uploadFile(uploadUrl, file);
      setStatus("Uploaded. Your lab result is being processed.");
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5">
        <p className="text-sm text-muted-foreground">Upload a lab result PDF for automatic extraction.</p>
        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            className="flex-1 rounded-md border border-input bg-transparent text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground"
          />
          <Button onClick={upload} disabled={uploading}>
            {uploading ? "Uploading..." : "Upload"}
          </Button>
        </div>
        {status && <span className="text-sm text-muted-foreground">{status}</span>}
      </CardContent>
    </Card>
  );
}
