"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";

export default function LoginPage() {
  const { signIn, startHostedSignIn, completeHostedSignIn } = useAuth();
  const router = useRouter();
  const [started, setStarted] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (completeHostedSignIn()) {
      router.push("/dashboard");
    }
  }, [completeHostedSignIn, router]);

  async function onPasswordSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setSubmitting(false);
    }
  }

  function onGoogleSignIn() {
    setError(null);
    try {
      startHostedSignIn();
    } catch {
      setError("Google sign-in is not configured yet. Add the Cognito Hosted UI settings described in the README.");
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <Card className="rounded-[2px] border border-border bg-card shadow-none">
        {!started ? (
          <>
            <CardHeader className="border-b border-border pb-4">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                [AUTH.PORTAL]
              </div>
              <CardTitle className="font-serif text-2xl font-semibold tracking-tight text-foreground">
                Welcome to Vitalis
              </CardTitle>
              <CardDescription className="font-serif text-xs text-muted-foreground">
                Access your clinical healthcare workspace.
              </CardDescription>
            </CardHeader>
            <CardFooter className="pt-6">
              <Button type="button" onClick={() => setStarted(true)} className="w-full">
                Sign in to Portal
              </Button>
            </CardFooter>
          </>
        ) : (
          <form onSubmit={onPasswordSignIn}>
            <CardHeader className="border-b border-border pb-4">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                [CREDENTIAL VERIFICATION]
              </div>
              <CardTitle className="font-serif text-2xl font-semibold tracking-tight text-foreground">
                Sign in
              </CardTitle>
              <CardDescription className="font-serif text-xs text-muted-foreground">
                New user?{" "}
                <Link href="/signup" className="text-foreground underline underline-offset-4 hover:text-muted-foreground">
                  Create an account
                </Link>
                .
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 pt-5">
              <Button type="button" variant="outline" onClick={onGoogleSignIn} className="w-full">
                Continue with Google
              </Button>
              <div className="relative text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground before:absolute before:left-0 before:top-1/2 before:w-[42%] before:border-t before:border-border after:absolute after:right-0 after:top-1/2 after:w-[42%] after:border-t after:border-border">
                <span className="relative bg-card px-2">OR</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email address</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
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
                {submitting ? "Verifying Credentials..." : "Sign in"}
              </Button>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}
