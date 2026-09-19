"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import type { Role } from "@/lib/types";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import { Stepper } from "@/components/ui/Stepper";

const steps = ["Details", "Confirm"];

export default function SignupPage() {
  const { signUp, confirmSignUp } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<"details" | "confirm">("details");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      <Stepper steps={steps} currentIndex={step === "details" ? 0 : 1} className="mb-6" />

      {step === "details" ? (
        <Card className="rounded-[2px] border border-border bg-card shadow-none">
          <form onSubmit={onSubmitDetails}>
            <CardHeader className="border-b border-border pb-4">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                [USER ONBOARDING]
              </div>
              <CardTitle className="font-serif text-2xl font-semibold tracking-tight text-foreground">
                Create an account
              </CardTitle>
              <CardDescription className="font-serif text-xs text-muted-foreground">
                Register as a verified patient or licensed provider.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 pt-5">
              <div>
                <Label>Clinical role</Label>
                <div className="mt-1.5 flex gap-2">
                  <Button
                    type="button"
                    variant={role === "patient" ? "primary" : "secondary"}
                    onClick={() => setRole("patient")}
                    className="flex-1"
                  >
                    Patient
                  </Button>
                  <Button
                    type="button"
                    variant={role === "doctor" ? "primary" : "secondary"}
                    onClick={() => setRole("doctor")}
                    className="flex-1"
                  >
                    Doctor
                  </Button>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="givenName">First name</Label>
                  <Input
                    id="givenName"
                    required
                    value={givenName}
                    onChange={(e) => setGivenName(e.target.value)}
                  />
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="familyName">Last name</Label>
                  <Input
                    id="familyName"
                    required
                    value={familyName}
                    onChange={(e) => setFamilyName(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email address</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password (min. 8 characters)</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground focus:outline-none"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {error && <p className="font-mono text-xs text-destructive">{error}</p>}
            </CardContent>
            <CardFooter className="border-t border-border pt-4">
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? "Registering Record..." : "Continue to Verification"}
              </Button>
            </CardFooter>
          </form>
        </Card>
      ) : (
        <Card className="rounded-[2px] border border-border bg-card shadow-none">
          <form onSubmit={onSubmitCode}>
            <CardHeader className="border-b border-border pb-4">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                [COGNITO CONFIRMATION]
              </div>
              <CardTitle className="font-serif text-2xl font-semibold tracking-tight text-foreground">
                Confirm your email
              </CardTitle>
              <CardDescription className="font-serif text-xs text-muted-foreground">
                Confirmation token dispatched to {email}.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 pt-5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="code">Confirmation code</Label>
                <Input id="code" required value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              {error && <p className="font-mono text-xs text-destructive">{error}</p>}
            </CardContent>
            <CardFooter className="border-t border-border pt-4">
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? "Confirming..." : "Confirm Account"}
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}
    </div>
  );
}
