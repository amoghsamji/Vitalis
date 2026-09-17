"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calendar, Clock, FileText, Pill, User } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useAsyncData } from "@/lib/useAsyncData";
import { resolvePatientNames } from "@/lib/resolvePatientNames";
import { api } from "@/lib/api";
import type { Appointment } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { buttonVariants } from "@/components/ui/Button";

interface DoctorDashboardData {
  kind: "doctor";
  appointments: Appointment[];
  openSlotCount: number;
  patientNames: Record<string, string>;
}

interface PatientDashboardData {
  kind: "patient";
  appointments: Appointment[];
  conditionCount: number;
  medicationCount: number;
}

type DashboardData = DoctorDashboardData | PatientDashboardData;

export default function DashboardPage() {
  // /dashboard isn't nested under doctor/patient layout.tsx (it serves both
  // roles), so it needs its own auth guard.
  const { session, role, loading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (authLoading) return;
    if (!session) router.replace("/login");
  }, [authLoading, session, router]);

  const { data, loading, error } = useAsyncData<DashboardData>(() => {
    if (!session || !role) return null;

    if (role === "doctor") {
      return (async () => {
        const [{ appointments }, { slots }] = await Promise.all([
          api.listDoctorAppointments(session.sub, session.idToken),
          api.listAvailability(session.sub),
        ]);
        const upcoming = appointments
          .filter((a) => a.status === "confirmed")
          .sort((a, b) => a.startTime.localeCompare(b.startTime));
        const recent = upcoming.slice(0, 5);
        const patientNames = await resolvePatientNames(
          recent.map((a) => a.patientId),
          session.idToken
        );
        return {
          kind: "doctor",
          appointments: upcoming,
          openSlotCount: slots.filter((s) => s.status === "open").length,
          patientNames,
        } satisfies DoctorDashboardData;
      })();
    }

    return (async () => {
      const [{ appointments }, { conditions }, { medications }] = await Promise.all([
        api.listPatientAppointments(session.sub, session.idToken),
        api.listConditions(session.sub, session.idToken),
        api.listMedications(session.sub, session.idToken),
      ]);
      const upcoming = appointments
        .filter((a) => a.status === "confirmed")
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      return {
        kind: "patient",
        appointments: upcoming,
        conditionCount: conditions.length,
        medicationCount: medications.length,
      } satisfies PatientDashboardData;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.sub, role]);

  if (authLoading || !session) return <LoadingState message="Loading dashboard..." />;

  const today = new Date().toDateString();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" subtitle={`Welcome back, ${session.email}`} />

      {loading || !data ? (
        <LoadingState message="Loading dashboard..." />
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : data.kind === "doctor" ? (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatCard icon={Calendar} label="Upcoming appointments" value={data.appointments.length} />
            <StatCard
              icon={Clock}
              label="Today"
              value={data.appointments.filter((a) => new Date(a.startTime).toDateString() === today).length}
            />
            <StatCard icon={User} label="Open slots" value={data.openSlotCount} />
          </div>

          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <Card padding="none" className="divide-y divide-slate-100">
              <h2 className="px-5 py-4 text-sm font-semibold">Recent appointments</h2>
              {data.appointments.length === 0 ? (
                <div className="px-5 pb-5">
                  <EmptyState message="No upcoming appointments." />
                </div>
              ) : (
                data.appointments.slice(0, 5).map((appt) => (
                  <div key={appt.id} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <p className="text-sm font-medium">{data.patientNames[appt.patientId] ?? appt.patientId}</p>
                      <p className="text-xs text-slate-500">
                        {new Date(appt.startTime).toLocaleString()} &middot; {appt.consultationType}
                      </p>
                    </div>
                    <Badge variant="success">{appt.status}</Badge>
                  </div>
                ))
              )}
            </Card>

            <Card className="flex flex-col gap-2">
              <h2 className="mb-1 text-sm font-semibold">Quick links</h2>
              <Link href="/doctor/appointments" className={buttonVariants({ variant: "secondary" })}>
                Appointments
              </Link>
              <Link href="/doctor/availability" className={buttonVariants({ variant: "secondary" })}>
                Availability
              </Link>
              <Link href="/doctor/workflows" className={buttonVariants({ variant: "secondary" })}>
                Workflows
              </Link>
              <Link href="/doctor/profile" className={buttonVariants({ variant: "secondary" })}>
                Profile
              </Link>
            </Card>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatCard icon={Calendar} label="Upcoming appointments" value={data.appointments.length} />
            <StatCard icon={FileText} label="Conditions" value={data.conditionCount} />
            <StatCard icon={Pill} label="Medications" value={data.medicationCount} />
          </div>

          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <Card padding="none" className="divide-y divide-slate-100">
              <h2 className="px-5 py-4 text-sm font-semibold">Upcoming appointments</h2>
              {data.appointments.length === 0 ? (
                <div className="px-5 pb-5">
                  <EmptyState
                    message="No upcoming appointments."
                    cta={{ label: "Find a doctor", href: "/patient/doctors" }}
                  />
                </div>
              ) : (
                data.appointments.slice(0, 5).map((appt) => (
                  <div key={appt.id} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <p className="text-sm font-medium">{new Date(appt.startTime).toLocaleString()}</p>
                      <p className="text-xs text-slate-500">{appt.consultationType}</p>
                    </div>
                    <Badge variant="success">{appt.status}</Badge>
                  </div>
                ))
              )}
            </Card>

            <Card className="flex flex-col gap-2">
              <h2 className="mb-1 text-sm font-semibold">Quick links</h2>
              <Link href="/patient/doctors" className={buttonVariants({ variant: "secondary" })}>
                Find a doctor
              </Link>
              <Link href="/patient/appointments" className={buttonVariants({ variant: "secondary" })}>
                My appointments
              </Link>
              <Link href="/patient/profile" className={buttonVariants({ variant: "secondary" })}>
                Profile
              </Link>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
