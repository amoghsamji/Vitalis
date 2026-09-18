"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { api } from "@/lib/api";
import type { Doctor } from "@/lib/types";
import { MOCK_DOCTORS } from "@/lib/mock-doctors";
import { PageHeader } from "@/components/ui/PageHeader";
import { cardVariants } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/shadcn/input";
import { Avatar, AvatarFallback } from "@/components/ui/shadcn/avatar";
import { cn } from "@/lib/utils";

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const MOCK_DOCTOR_IDS = new Set(MOCK_DOCTORS.map((d) => d.id));

export default function FindDoctorPage() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [specialty, setSpecialty] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(filters?: { specialty?: string }) {
    setLoading(true);
    setError(null);
    try {
      const { doctors: realDoctors } = await api.listDoctors(
        filters?.specialty ? { specialty: filters.specialty } : undefined
      );
      // Demo doctors are always shown alongside real ones (clearly labeled),
      // not just as a fallback when the directory is empty, so the directory
      // never looks emptier than it is while you're still onboarding real
      // doctors.
      const q = filters?.specialty?.toLowerCase();
      const mockMatches = q ? MOCK_DOCTORS.filter((d) => d.specialty.toLowerCase().includes(q)) : MOCK_DOCTORS;
      setDoctors([...realDoctors, ...mockMatches]);
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
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Filter by specialty"
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
                className="pl-8"
              />
            </div>
            <Button variant="secondary" type="submit">
              Filter
            </Button>
          </form>
        }
      />

      {loading && <LoadingState message="Loading doctors..." />}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!loading && doctors.length === 0 && <EmptyState message="No doctors found." />}

      <div className="grid gap-4 sm:grid-cols-2">
        {doctors.map((doctor) => (
          <Link
            href={`/patient/doctor?id=${doctor.id}`}
            key={doctor.id}
            className={cn(cardVariants(), "transition-colors hover:border-primary")}
          >
            <div className="flex items-center gap-3">
              <Avatar>
                <AvatarFallback>{initials(doctor.name)}</AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-semibold">{doctor.name}</h2>
                  <div className="flex items-center gap-1.5">
                    {MOCK_DOCTOR_IDS.has(doctor.id) && <Badge variant="info">Demo doctor</Badge>}
                    <Badge variant={doctor.availabilityStatus === "available_now" ? "success" : "neutral"}>
                      {doctor.availabilityStatus === "available_now" ? "Available now" : "Unavailable"}
                    </Badge>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{doctor.specialty}</p>
              </div>
            </div>
            <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{doctor.bio}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
