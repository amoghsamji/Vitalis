import Link from "next/link";
import { AlertCircle, CheckCircle2, FileText, ArrowLeft } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms and Conditions | Vitalis Healthcare Platform",
  description: "Terms of service, medical disclaimers, and user responsibilities for the Vitalis platform.",
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl py-2">
      <div className="mb-6 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
        <Link href="/" className="inline-flex items-center gap-1.5 hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> [BACK TO CLINICAL OVERVIEW]
        </Link>
      </div>

      <div className="mb-8 border-b border-border pb-6">
        <div className="inline-flex items-center gap-2 rounded-[2px] border border-border bg-card px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          DOC.REF // MASTER TERMS OF SERVICE
        </div>
        <h1 className="mt-4 font-serif text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Terms and Conditions
        </h1>
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          EFFECTIVE: JANUARY 1, 2025 // REVISED: SEPTEMBER 2025
        </p>
      </div>

      <div className="space-y-8 text-sm leading-relaxed text-foreground">
        {/* Critical Emergency Disclaimer Placard */}
        <section className="rounded-[2px] border border-destructive/40 bg-card p-5 text-foreground">
          <div className="flex items-center gap-2">
            <span className="rounded-[2px] border border-destructive/50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-destructive">
              CRITICAL NOTICE
            </span>
            <h2 className="font-serif text-sm font-semibold text-destructive">
              Not for Immediate Emergency Care
            </h2>
          </div>
          <p className="mt-2.5 font-serif text-xs leading-relaxed text-muted-foreground">
            Vitalis is an asynchronous clinical coordination, scheduling, and diagnostic intake system. It is
            <strong className="text-foreground"> not an emergency medical service</strong>. If you or someone in your care is experiencing a medical
            emergency, life-threatening condition, chest pain, acute shortness of breath, or trauma, call 911 or your local
            emergency services immediately, or proceed to the nearest emergency department. Do not rely on Vitalis for urgent medical assistance.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">1. Agreement to Terms</h2>
          <p>
            By accessing, creating an account, or utilizing the Vitalis healthcare platform (&quot;Service&quot;), you
            agree to be legally bound by these Terms and Conditions (&quot;Terms&quot;). If you are registering as a
            healthcare provider, you represent that you hold all required medical licenses and credentials in your jurisdiction.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">2. Clinical Independence and Medical Advice Disclaimer</h2>
          <p>
            Vitalis provides software infrastructure to facilitate clinical scheduling, document ingestion, and follow-up
            automation. Vitalis itself does not practice medicine, render clinical advice, or make medical diagnoses.
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-slate-600">
            <li>
              <strong>Independent Medical Judgment:</strong> All diagnoses, prescriptions, treatment regimens, and medical decisions
              remain the sole responsibility of licensed treating healthcare practitioners.
            </li>
            <li>
              <strong>No Substitute for Clinical Evaluation:</strong> Asynchronous records, laboratory PDF extracts, and automated
              check-in transcripts assist providers but do not replace thorough clinical evaluation by a medical professional.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">3. User Accounts and Authentication</h2>
          <p>
            Access requires authentication through Amazon Cognito. Users agree to:
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-slate-600">
            <li>Provide accurate, current, and complete registration information during onboarding.</li>
            <li>Maintain the confidentiality of login credentials and session tokens.</li>
            <li>Promptly notify the security team of any unauthorized access or breach of credentials.</li>
            <li>Never impersonate another patient or healthcare provider or access health records without explicit authorization.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">4. Provider Obligations</h2>
          <p>
            Practitioners utilizing Vitalis to publish availability or manage patient appointments agree to:
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-slate-600">
            <li>Maintain active, unrestricted professional licensure and appropriate professional liability coverage.</li>
            <li>Ensure that all automated workflow rules, SMS messages, and voice prompts comply with applicable standards of clinical care.</li>
            <li>Accurately reflect appointment availability and respond to patient scheduling requests promptly.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">5. Patient Responsibilities</h2>
          <p>
            Patients utilizing Vitalis agree to:
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-slate-600">
            <li>Provide accurate health histories, known medical conditions, and current medications.</li>
            <li>Attend scheduled appointments or cancel with reasonable advance notice.</li>
            <li>Review consent disclosures prior to opting into automated voice or SMS follow-up communications.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">6. Platform Availability and Service Level</h2>
          <p>
            Vitalis is engineered for high availability on AWS managed services. However, uninterrupted access cannot be
            guaranteed. The platform may undergo maintenance or experience downtime. Vitalis is not liable for appointment
            rescheduling necessitated by technical interruptions.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">7. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by applicable law, Vitalis and its operators shall not be liable for indirect,
            incidental, special, consequential, or punitive damages, or loss of profits or data, resulting from your access
            to or inability to access the service, or any medical treatment decisions rendered by independent healthcare providers.
          </p>
        </section>

        <section className="space-y-3 border-t border-border pt-6">
          <h2 className="text-lg font-semibold text-slate-900">8. Governing Law and Inquiries</h2>
          <p>
            These Terms are governed by and construed in accordance with applicable federal and state laws.
            For questions regarding these Terms, contact our legal counsel:
          </p>
          <div className="rounded-md border border-border bg-card p-4 text-xs">
            <p className="font-semibold text-foreground">Vitalis Legal and Governance Office</p>
            <p className="mt-1 text-muted-foreground">Email: legal@vitalis-health.internal</p>
            <p className="text-muted-foreground">Operational Region: AWS US East</p>
          </div>
        </section>
      </div>
    </div>
  );
}
