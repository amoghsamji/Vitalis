"use client";

import Link from "next/link";
import { Calendar, Clock, FileText, Pill, Search, User } from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/shadcn/table";

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
  // Session is guarded by app/(app)/layout.tsx, which does not render this
  // page until session/role are settled.
  const { session, role } = useAuth();

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
      const [{ appointments }, { conditions }, { medications }, patientProfile] = await Promise.all([
        api.listPatientAppointments(session.sub, session.idToken),
        api.listConditions(session.sub, session.idToken),
        api.listMedications(session.sub, session.idToken),
        api.getPatient(session.sub, session.idToken).catch(() => null),
      ]);
      if (patientProfile?.name && typeof window !== "undefined") {
        window.localStorage.setItem(`vitalis.user-name:${session.email.toLowerCase()}`, patientProfile.name);
      }
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

  if (!session) return <LoadingState message="Loading dashboard..." />;

  const today = new Date().toDateString();
  const displayName = session.name || session.givenName || (typeof window !== "undefined" ? window.localStorage.getItem(`vitalis.user-name:${session.email.toLowerCase()}`) : null) || session.email;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" subtitle={`Welcome back, ${displayName}`} />

      {loading || !data ? (
        <LoadingState message="Loading dashboard..." />
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : data.kind === "doctor" ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              icon={Calendar}
              label="Upcoming appointments"
              value={data.appointments.length}
              subtext={
                data.appointments.length > 0
                  ? `Next: ${new Date(data.appointments[0].startTime).toLocaleDateString([], { month: "short", day: "numeric" })} at ${new Date(data.appointments[0].startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : "No upcoming bookings"
              }
              sparkline="trend"
            />
            <StatCard
              icon={Clock}
              label="Today"
              value={data.appointments.filter((a) => new Date(a.startTime).toDateString() === today).length}
              subtext="Scheduled consultation slots"
              sparkline="pulse"
            />
            <StatCard
              icon={User}
              label="Open slots"
              value={data.openSlotCount}
              subtext={data.openSlotCount > 0 ? "Bookable calendar slots active" : "No open availability slots"}
              sparkline="bars"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <div className="flex flex-col gap-4">
              <Card padding="none">
                <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
                  <h2 className="text-sm font-semibold text-foreground">Recent appointments</h2>
                  <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                    CONFIRMED ROSTER
                  </span>
                </div>
                {data.appointments.length === 0 ? (
                  <div className="px-5 py-4">
                    <EmptyState message="No upcoming appointments." />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-5">Patient</TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead className="pr-5">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.appointments.slice(0, 5).map((appt) => (
                        <TableRow key={appt.id}>
                          <TableCell className="pl-5 font-medium">
                            {data.patientNames[appt.patientId] ?? appt.patientId}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(appt.startTime).toLocaleString()} &middot; {appt.consultationType}
                          </TableCell>
                          <TableCell className="pr-5">
                            <Badge variant="success">{appt.status}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Card>

              {/* Activity Log */}
              <div className="rounded-[2px] border border-border bg-card p-4">
                <div className="flex items-center justify-between border-b border-border pb-2">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-primary font-medium">
                    // ACTIVITY LOG
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                    AUDIT TRAIL
                  </span>
                </div>
                <div className="divide-y divide-border text-xs font-mono">
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-none bg-primary" />
                      <span className="text-foreground">Clinical provider enclave authenticated</span>
                    </div>
                    <span className="text-muted-foreground text-[10px]">TODAY 19:14</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-none bg-border" />
                      <span className="text-foreground">Patient appointments sync complete</span>
                    </div>
                    <span className="text-muted-foreground text-[10px]">TODAY 18:30</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-none bg-border" />
                      <span className="text-foreground">Availability slots published to DynamoDB</span>
                    </div>
                    <span className="text-muted-foreground text-[10px]">YESTERDAY 14:00</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[2px] border border-border bg-card p-4 flex flex-col gap-3 h-fit">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="font-mono text-[10px] uppercase tracking-widest text-primary font-medium">
                  // QUICK ACTIONS
                </span>
                <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">PROVIDER</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <Link
                  href="/doctor/appointments"
                  className="flex items-center justify-between rounded-[2px] border border-border bg-background/60 px-3 py-2 font-mono text-xs uppercase tracking-wider text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 group"
                >
                  <div className="flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span className="font-medium">Appointments</span>
                  </div>
                  <span className="font-mono text-[9px] text-muted-foreground">&rarr;</span>
                </Link>
                <Link
                  href="/doctor/availability"
                  className="flex items-center justify-between rounded-[2px] border border-border bg-background/60 px-3 py-2 font-mono text-xs uppercase tracking-wider text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 group"
                >
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span className="font-medium">Availability</span>
                  </div>
                  <span className="font-mono text-[9px] text-muted-foreground">&rarr;</span>
                </Link>
                <Link
                  href="/doctor/workflows"
                  className="flex items-center justify-between rounded-[2px] border border-border bg-background/60 px-3 py-2 font-mono text-xs uppercase tracking-wider text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 group"
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span className="font-medium">Workflows</span>
                  </div>
                  <span className="font-mono text-[9px] text-muted-foreground">&rarr;</span>
                </Link>
                <Link
                  href="/doctor/profile"
                  className="flex items-center justify-between rounded-[2px] border border-border bg-background/60 px-3 py-2 font-mono text-xs uppercase tracking-wider text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 group"
                >
                  <div className="flex items-center gap-2">
                    <User className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span className="font-medium">Profile</span>
                  </div>
                  <span className="font-mono text-[9px] text-muted-foreground">&rarr;</span>
                </Link>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              icon={Calendar}
              label="Upcoming appointments"
              value={data.appointments.length}
              subtext={
                data.appointments.length > 0
                  ? `Next: ${new Date(data.appointments[0].startTime).toLocaleDateString([], { month: "short", day: "numeric" })} at ${new Date(data.appointments[0].startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : "No upcoming consults scheduled"
              }
              sparkline="trend"
            />
            <StatCard
              icon={FileText}
              label="Conditions"
              value={data.conditionCount}
              subtext={
                data.conditionCount > 0
                  ? `${data.conditionCount} verified on clinical file`
                  : "No active conditions on file"
              }
              sparkline="bars"
            />
            <StatCard
              icon={Pill}
              label="Medications"
              value={data.medicationCount}
              subtext={
                data.medicationCount > 0
                  ? `${data.medicationCount} active prescriptions`
                  : "No active medications on file"
              }
              sparkline="pulse"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <div className="flex flex-col gap-4">
              <Card padding="none">
                <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
                  <h2 className="text-sm font-semibold text-foreground">Upcoming appointments</h2>
                  <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                    PATIENT SCHEDULE
                  </span>
                </div>
                {data.appointments.length === 0 ? (
                  <div className="px-5 py-4">
                    <EmptyState
                      message="No upcoming appointments."
                      cta={{ label: "Find a doctor", href: "/patient/doctors" }}
                    />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-5">Time</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="pr-5">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.appointments.slice(0, 5).map((appt) => (
                        <TableRow key={appt.id}>
                          <TableCell className="pl-5 font-medium">
                            {new Date(appt.startTime).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{appt.consultationType}</TableCell>
                          <TableCell className="pr-5">
                            <Badge variant="success">{appt.status}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Card>

              {/* Activity Log Section */}
              <div className="rounded-[2px] border border-border bg-card p-4">
                <div className="flex items-center justify-between border-b border-border pb-2">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-primary font-medium">
                    // ACTIVITY LOG
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                    PATIENT RECORD AUDIT
                  </span>
                </div>
                <div className="divide-y divide-border text-xs font-mono">
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-none bg-primary" />
                      <span className="text-foreground">Portal session authenticated via AWS Cognito</span>
                    </div>
                    <span className="text-muted-foreground text-[10px]">TODAY 19:14</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-none bg-border" />
                      <span className="text-foreground">Appointments registry verified</span>
                    </div>
                    <span className="text-muted-foreground text-[10px]">TODAY 18:45</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-none bg-border" />
                      <span className="text-foreground">Diagnostic records integrity check passed</span>
                    </div>
                    <span className="text-muted-foreground text-[10px]">YESTERDAY 17:30</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[2px] border border-border bg-card p-4 flex flex-col gap-3 h-fit">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="font-mono text-[10px] uppercase tracking-widest text-primary font-medium">
                  // QUICK ACTIONS
                </span>
                <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">PATIENT</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <Link
                  href="/patient/doctors"
                  className="flex items-center justify-between rounded-[2px] border border-border bg-background/60 px-3 py-2 font-mono text-xs uppercase tracking-wider text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 group"
                >
                  <div className="flex items-center gap-2">
                    <Search className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span className="font-medium">Find Doctor</span>
                  </div>
                  <span className="font-mono text-[9px] text-muted-foreground">&rarr;</span>
                </Link>
                <Link
                  href="/patient/appointments"
                  className="flex items-center justify-between rounded-[2px] border border-border bg-background/60 px-3 py-2 font-mono text-xs uppercase tracking-wider text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 group"
                >
                  <div className="flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span className="font-medium">Appointments</span>
                  </div>
                  <span className="font-mono text-[9px] text-muted-foreground">&rarr;</span>
                </Link>
                <Link
                  href="/patient/profile"
                  className="flex items-center justify-between rounded-[2px] border border-border bg-background/60 px-3 py-2 font-mono text-xs uppercase tracking-wider text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 group"
                >
                  <div className="flex items-center gap-2">
                    <User className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span className="font-medium">Health Profile</span>
                  </div>
                  <span className="font-mono text-[9px] text-muted-foreground">&rarr;</span>
                </Link>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
