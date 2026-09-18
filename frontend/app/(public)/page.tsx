"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, FileText, Workflow } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { buttonVariants } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";

const features = [
  {
    icon: CalendarCheck,
    title: "Scheduling",
    description: "Doctors publish availability, patients book in a couple of clicks.",
  },
  {
    icon: FileText,
    title: "Lab intake",
    description: "Upload lab PDFs and have results extracted automatically.",
  },
  {
    icon: Workflow,
    title: "Automated follow-up",
    description: "Build workflows that trigger reminders and outreach on their own.",
  },
];

export default function HomePage() {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading || !session) return;
    router.replace("/dashboard");
  }, [loading, session, router]);

  return (
    <div className="flex flex-col gap-20 py-10">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-indigo-600 via-indigo-500 to-violet-600 px-8 py-20 text-center shadow-lg">
        <div className="relative flex flex-col items-center gap-6">
          <h1 className="max-w-2xl text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Healthcare workflows, without the busywork
          </h1>
          <p className="max-w-xl text-indigo-100">
            Vitalis connects doctors and patients for scheduling, lab intake, and
            automated follow-up &mdash; built on AWS-managed services end to end.
          </p>
          <div className="flex">
            <Link
              href="/login"
              className={buttonVariants({
                variant: "primary",
                className: "bg-white text-indigo-700 shadow-md hover:bg-indigo-50",
              })}
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        {features.map(({ icon: Icon, title, description }) => (
          <Card key={title}>
            <CardContent className="flex flex-col gap-3 pt-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <h2 className="font-semibold text-foreground">{title}</h2>
              <p className="text-sm text-muted-foreground">{description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
