"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Doctor } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/LoadingState";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import { Textarea } from "@/components/ui/shadcn/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/shadcn/select";

const blankDoctor = (id: string, name: string): Doctor => ({
  id,
  name,
  specialty: "",
  languages: [],
  consultationTypes: ["video"],
  bio: "",
  availabilityStatus: "unavailable",
  averageRating: null,
});

export default function DoctorProfilePage() {
  const { session } = useAuth();
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [languagesInput, setLanguagesInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    api
      .getDoctor(session.sub)
      .then((d) => {
        setDoctor(d);
        setLanguagesInput(d.languages.join(", "));
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setDoctor(blankDoctor(session.sub, session.email));
        } else {
          setError(err instanceof Error ? err.message : "Failed to load profile");
        }
      })
      .finally(() => setLoading(false));
  }, [session]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !doctor) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const body = {
        ...doctor,
        languages: languagesInput
          .split(",")
          .map((l) => l.trim())
          .filter(Boolean),
      };
      const saved = await api.updateDoctor(session.sub, body, session.idToken);
      setDoctor(saved);
      setMessage("Profile saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !doctor) return <LoadingState />;

  return (
    <div className="max-w-2xl">
      <PageHeader title="My profile" className="mb-4" />
      <Card>
        <CardContent className="pt-5">
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={doctor.name} onChange={(e) => setDoctor({ ...doctor, name: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="specialty">Specialty</Label>
              <Input
                id="specialty"
                value={doctor.specialty}
                onChange={(e) => setDoctor({ ...doctor, specialty: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="languages">Languages (comma separated)</Label>
              <Input id="languages" value={languagesInput} onChange={(e) => setLanguagesInput(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                rows={4}
                value={doctor.bio}
                onChange={(e) => setDoctor({ ...doctor, bio: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Availability status</Label>
              <Select
                value={doctor.availabilityStatus}
                onValueChange={(v) =>
                  setDoctor({ ...doctor, availabilityStatus: v as Doctor["availabilityStatus"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="available_now">Available now</SelectItem>
                  <SelectItem value="unavailable">Unavailable</SelectItem>
                </SelectContent>
              </Select>
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
    </div>
  );
}
