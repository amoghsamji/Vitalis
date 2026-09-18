import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { Toaster } from "@/components/ui/shadcn/sonner";

export const metadata: Metadata = {
  title: "Vitalis | Clinical Operations & Workflow Platform",
  description: "Secure healthcare coordination infrastructure for provider scheduling, diagnostic lab intake, and auditable clinical workflows.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          {children}
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
