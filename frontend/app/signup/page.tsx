"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import type { Role } from "@/lib/types";
import { cardVariants } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function SignupPage() {
  const { signUp, confirmSignUp } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<"details" | "confirm">("details");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [role, setRole] = useState<Role>("patient");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmitDetails(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signUp(email, password, givenName, familyName, role);
      setStep("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await confirmSignUp(email, code);
      router.push("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirmation failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-2xl font-semibold">Create an account</h1>

      {step === "details" ? (
        <form onSubmit={onSubmitDetails} className={cardVariants({ className: "flex flex-col gap-4" })}>
          <div>
            <label className="label">I am a...</label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={role === "patient" ? "primary" : "secondary"}
                onClick={() => setRole("patient")}
              >
                Patient
              </Button>
              <Button
                type="button"
                variant={role === "doctor" ? "primary" : "secondary"}
                onClick={() => setRole("doctor")}
              >
                Doctor
              </Button>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="label">First name</label>
              <input className="input" required value={givenName} onChange={(e) => setGivenName(e.target.value)} />
            </div>
            <div className="flex-1">
              <label className="label">Last name</label>
              <input className="input" required value={familyName} onChange={(e) => setFamilyName(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating account..." : "Sign up"}
          </Button>
        </form>
      ) : (
        <form onSubmit={onSubmitCode} className={cardVariants({ className: "flex flex-col gap-4" })}>
          <p className="text-sm text-slate-600">We sent a confirmation code to {email}.</p>
          <div>
            <label className="label">Confirmation code</label>
            <input className="input" required value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Confirming..." : "Confirm"}
          </Button>
        </form>
      )}
    </div>
  );
}
