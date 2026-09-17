"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Doctor } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { cardVariants } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/LoadingState";

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
      <form onSubmit={save} className={cardVariants({ className: "grid gap-4 sm:grid-cols-2" })}>
        <div>
          <label className="label">Name</label>
          <input className="input" value={doctor.name} onChange={(e) => setDoctor({ ...doctor, name: e.target.value })} />
        </div>
        <div>
          <label className="label">Specialty</label>
          <input
            className="input"
            value={doctor.specialty}
            onChange={(e) => setDoctor({ ...doctor, specialty: e.target.value })}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Languages (comma separated)</label>
          <input className="input" value={languagesInput} onChange={(e) => setLanguagesInput(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Bio</label>
          <textarea
            className="input"
            rows={4}
            value={doctor.bio}
            onChange={(e) => setDoctor({ ...doctor, bio: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Availability status</label>
          <select
            className="input"
            value={doctor.availabilityStatus}
            onChange={(e) =>
              setDoctor({ ...doctor, availabilityStatus: e.target.value as Doctor["availabilityStatus"] })
            }
          >
            <option value="available_now">Available now</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </div>
        <div className="sm:col-span-2 flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save profile"}
          </Button>
          {message && <span className="text-sm text-green-600">{message}</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </form>
    </div>
  );
}
