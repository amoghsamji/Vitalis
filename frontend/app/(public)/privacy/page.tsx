import Link from "next/link";
import { ShieldCheck, Lock, FileText, ArrowLeft } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | Vitalis Healthcare Platform",
  description: "Notice of Privacy Practices, HIPAA alignment, and data security policies for Vitalis.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="mx-auto max-w-3xl py-2">
      <div className="mb-6 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
        <Link href="/" className="inline-flex items-center gap-1.5 hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> [BACK TO CLINICAL OVERVIEW]
        </Link>
      </div>

      <div className="mb-8 border-b border-border pb-6">
        <div className="inline-flex items-center gap-2 rounded-[2px] border border-border bg-card px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          DOC.REF // HIPAA NOTICE OF PRIVACY PRACTICES
        </div>
        <h1 className="mt-4 font-serif text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Privacy Policy
        </h1>
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          EFFECTIVE: JANUARY 1, 2025 // AUDIT VERIFICATION: SEPTEMBER 2025
        </p>
      </div>

      <div className="space-y-8 text-sm leading-relaxed text-slate-700">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">1. Commitment to Health Data Confidentiality</h2>
          <p>
            Vitalis Health Systems operates clinical workflow and scheduling infrastructure. We are committed to
            protecting the privacy and confidentiality of Protected Health Information (PHI) and Personally Identifiable
            Information (PII) entrusted to us by healthcare providers and patients.
          </p>
          <p>
            This Privacy Policy outlines how Vitalis collects, maintains, encrypts, and processes health data in
            accordance with the Health Insurance Portability and Accountability Act of 1996 (HIPAA), the Health Information
            Technology for Economic and Clinical Health (HITECH) Act, and applicable federal and state privacy statutes.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">2. Information We Collect</h2>
          <p>
            We process data strictly required to deliver clinical appointment scheduling, lab diagnostic intake, and
            physician-directed workflow operations:
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-slate-600">
            <li>
              <strong>Account and Identity Credentials:</strong> First name, last name, email address, phone number,
              and cryptographic role tokens managed via Amazon Cognito.
            </li>
            <li>
              <strong>Clinical Profile Information:</strong> Medical Record Number (MRN), insurance details, known
              conditions (ICD-10 classifications), active medications, and dosage schedules provided by patients or treating providers.
            </li>
            <li>
              <strong>Diagnostic and Laboratory Documents:</strong> Laboratory panels, diagnostic notes, and intake PDF
              documents uploaded by clinical teams for automated extraction and medical record indexing.
            </li>
            <li>
              <strong>Audit and Workflow Telemetry:</strong> Timestamped execution records, appointment status updates,
              and telephony logs from automated patient outreach protocols.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">3. Cloud Infrastructure and Technical Safeguards</h2>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 font-medium text-slate-900">
              <Lock className="h-4 w-4 text-slate-700" />
              <span>Data Protection Architecture</span>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              All infrastructure components reside within Amazon Web Services (AWS) healthcare-eligible services:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">
              <li><strong>Encryption at Rest:</strong> DynamoDB tables and Amazon S3 buckets are encrypted using AWS KMS with AES-256 standard encryption.</li>
              <li><strong>Encryption in Transit:</strong> All API communication and static asset delivery enforce TLS 1.3 transport encryption.</li>
              <li><strong>Zero Permanent Server Compute:</strong> Ephemeral serverless execution (AWS Lambda) ensures data is never cached on persistent host servers.</li>
              <li><strong>Role-Based Access:</strong> Cognito group claims strictly partition provider capabilities from patient records.</li>
            </ul>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">4. Automated Communications and Voice Outreach Protocols</h2>
          <p>
            Vitalis provides an automated follow-up telephony system powered by Amazon Connect and conversational voice agents (Lex V2)
            to check on patient recovery following completed clinical visits:
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-slate-600">
            <li>
              <strong>Explicit Prior Consent:</strong> Automated telephone checks and SMS follow-ups are only initiated if
              a patient has explicitly opted in within their profile preferences.
            </li>
            <li>
              <strong>Identity Verification Pre-Check:</strong> The automated voice bot identifies itself as Vitalis Clinical
              Follow-Up and verifies patient identity by first name prior to discussing any health or medication topics.
            </li>
            <li>
              <strong>Right to Revoke:</strong> Patients may revoke follow-up outreach consent at any time via their profile settings,
              halting all further automated calls immediately.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">5. Disclosure of Protected Information</h2>
          <p>
            We do not sell, license, or monetize patient or provider data. We disclose health records solely under the following conditions:
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-slate-600">
            <li>
              <strong>Direct Clinical Treatment:</strong> Between authorized healthcare practitioners and patients participating
              in consultations and care workflows.
            </li>
            <li>
              <strong>Covered Entity Operations:</strong> Secure processing by HIPAA Business Associates bound by written Business Associate Agreements (BAAs).
            </li>
            <li>
              <strong>Legal and Regulatory Mandates:</strong> When required by court orders, valid administrative subpoenas, or applicable public health reporting laws.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">6. Patient Rights Under HIPAA</h2>
          <p>
            Patients possess statutory rights regarding their health information maintained on the platform:
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-slate-600">
            <li>The right to inspect and receive an electronic copy of their medical profile and appointment history.</li>
            <li>The right to request corrections or amendments to inaccurate records.</li>
            <li>The right to obtain an accounting of disclosures of health information.</li>
            <li>The right to request confidential communications via specific numbers or addresses.</li>
          </ul>
        </section>

        <section className="space-y-3 border-t border-border pt-6">
          <h2 className="text-lg font-semibold text-slate-900">7. Data Protection Officer and Contact Information</h2>
          <p>
            For questions regarding this policy, HIPAA compliance requests, or exercising patient rights:
          </p>
          <div className="rounded-md border border-border bg-card p-4 text-xs">
            <p className="font-semibold text-foreground">Vitalis Privacy and Security Office</p>
            <p className="mt-1 text-muted-foreground">Attention: Privacy Officer &amp; HIPAA Compliance Team</p>
            <p className="text-muted-foreground">Email: privacy@vitalis-health.internal</p>
            <p className="text-muted-foreground">Location: AWS US East Cloud Infrastructure</p>
          </div>
        </section>
      </div>
    </div>
  );
}
