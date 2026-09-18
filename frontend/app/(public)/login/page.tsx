"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
      <Card>
        {!started ? (
          <>
            <CardHeader>
              <CardTitle className="text-xl">Welcome to Vitalis</CardTitle>
              <CardDescription>Access your healthcare workspace.</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button type="button" onClick={() => setStarted(true)} className="w-full">Sign in</Button>
            </CardFooter>
          </>
        ) : (
          <form onSubmit={onPasswordSignIn}>
            <CardHeader>
              <CardTitle className="text-xl">Sign in</CardTitle>
              <CardDescription>New here? <Link href="/signup" className="text-primary hover:underline">Create an account</Link>.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Button type="button" variant="secondary" onClick={onGoogleSignIn} className="w-full">
                Continue with Google
              </Button>
              <div className="relative text-center text-xs text-muted-foreground before:absolute before:left-0 before:top-1/2 before:w-[45%] before:border-t before:border-border after:absolute after:right-0 after:top-1/2 after:w-[45%] after:border-t after:border-border">
                <span className="relative bg-card px-2">or</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={submitting} className="w-full">{submitting ? "Signing in..." : "Sign in"}</Button>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}
