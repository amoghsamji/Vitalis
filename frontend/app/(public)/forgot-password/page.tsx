"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import { Stepper } from "@/components/ui/Stepper";

const steps = ["Request code", "Reset password"];

export default function ForgotPasswordPage() {
  const { forgotPassword, confirmForgotPassword } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<"request" | "reset" | "done">("request");
  const [email, setEmail] = useState(() =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("email") ?? ""
  );
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onRequestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await forgotPassword(email);
      setStep("reset");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reset code");
    } finally {
      setSubmitting(false);
    }
  }

  async function onResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await confirmForgotPassword(email, code, newPassword);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      {step !== "done" && <Stepper steps={steps} currentIndex={step === "request" ? 0 : 1} className="mb-6" />}

      {step === "request" ? (
        <Card className="rounded-[2px] border border-border bg-card shadow-none">
          <form onSubmit={onRequestCode}>
            <CardHeader className="border-b border-border pb-4">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                [ACCOUNT RECOVERY]
              </div>
              <CardTitle className="font-serif text-2xl font-semibold tracking-tight text-foreground">
                Forgot password
              </CardTitle>
              <CardDescription className="font-serif text-xs text-muted-foreground">
                We&apos;ll email you a code to set up a new password.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 pt-5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email address</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              {error && <p className="font-mono text-xs text-destructive">{error}</p>}
            </CardContent>
            <CardFooter className="flex flex-col gap-3 border-t border-border pt-4">
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? "Sending code..." : "Send reset code"}
              </Button>
              <Link
                href="/login"
                className="text-center font-serif text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Back to sign in
              </Link>
            </CardFooter>
          </form>
        </Card>
      ) : step === "reset" ? (
        <Card className="rounded-[2px] border border-border bg-card shadow-none">
          <form onSubmit={onResetPassword}>
            <CardHeader className="border-b border-border pb-4">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                [COGNITO CONFIRMATION]
              </div>
              <CardTitle className="font-serif text-2xl font-semibold tracking-tight text-foreground">
                Set a new password
              </CardTitle>
              <CardDescription className="font-serif text-xs text-muted-foreground">
                Reset code dispatched to {email}.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 pt-5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="code">Reset code</Label>
                <Input id="code" required value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="newPassword">New password (min. 8 characters)</Label>
                <div className="relative">
                  <Input
                    id="newPassword"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
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
                {submitting ? "Resetting..." : "Reset password"}
              </Button>
            </CardFooter>
          </form>
        </Card>
      ) : (
        <Card className="rounded-[2px] border border-border bg-card shadow-none">
          <CardHeader className="border-b border-border pb-4">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              [PASSWORD RESET]
            </div>
            <CardTitle className="font-serif text-2xl font-semibold tracking-tight text-foreground">
              Password updated
            </CardTitle>
            <CardDescription className="font-serif text-xs text-muted-foreground">
              You can now sign in with your new password.
            </CardDescription>
          </CardHeader>
          <CardFooter className="pt-6">
            <Button type="button" onClick={() => router.push("/login")} className="w-full">
              Back to sign in
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
