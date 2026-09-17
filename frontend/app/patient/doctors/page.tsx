"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Doctor } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { cardVariants } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

export default function FindDoctorPage() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [specialty, setSpecialty] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(filters?: { specialty?: string }) {
    setLoading(true);
    setError(null);
    try {
      const { doctors } = await api.listDoctors(filters?.specialty ? { specialty: filters.specialty } : undefined);
      setDoctors(doctors);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load doctors");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Find a doctor"
        actions={
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              load({ specialty });
            }}
          >
            <input
              className="input"
              placeholder="Filter by specialty"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
            />
            <Button variant="secondary" type="submit">
              Filter
            </Button>
          </form>
        }
      />

      {loading && <LoadingState message="Loading doctors..." />}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && doctors.length === 0 && <EmptyState message="No doctors found." />}

      <div className="grid gap-4 sm:grid-cols-2">
        {doctors.map((doctor) => (
          <Link
            href={`/patient/doctor?id=${doctor.id}`}
            key={doctor.id}
            className={cn(cardVariants(), "hover:border-brand-500")}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{doctor.name}</h2>
              <Badge variant={doctor.availabilityStatus === "available_now" ? "success" : "neutral"}>
                {doctor.availabilityStatus === "available_now" ? "Available now" : "Unavailable"}
              </Badge>
            </div>
            <p className="text-sm text-slate-600">{doctor.specialty}</p>
            <p className="mt-2 text-sm text-slate-500 line-clamp-2">{doctor.bio}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
