# Vitalis — Healthcare Workflow Automation Platform

A complete, serverless healthcare platform built on AWS. Vitalis enables doctors and patients to schedule appointments, manage medical records, issue prescriptions, and automate post-visit follow-up calls using AI-powered conversations.

## Core Features

- **User Management** — Cognito-based authentication with role-based access (Doctors/Patients), sign-up with role selection, Google OAuth integration, account recovery via email
- **Doctor & Patient Profiles** — Profile management with medical history, conditions, medications, phone numbers, and consent preferences
- **Appointment Scheduling** — Full booking system with availability management, appointment status tracking, and patient/doctor coordination
- **Lab PDF Processing** — Automatic extraction of lab results from uploaded PDFs using Amazon Textract
- **Prescription Management** — Doctors can issue both digital prescriptions (structured diagnosis, medications, notes) and upload PDF prescriptions. Patients can view prescriptions with audio playback (Amazon Polly) and translation (Amazon Translate)
- **Automated Follow-up Calls** — AI-powered phone calls to check patient recovery status post-appointment. Support for multiple telephony providers: Twilio Voice with Gemini, Amazon Connect with Lex V2, or Amazon Chime SDK Voice
- **Workflow Automation** — No-code workflow engine to automate actions like SMS notifications and appointment scheduling based on triggers (lab results, appointments, etc.)
- **Modern Frontend** — Full-featured Next.js web application with sign-in/sign-up, forgot-password recovery, doctor directory, appointment management, and prescription handling

## Architecture

- **`bin/vitalis.ts` / `lib/vitalis-stack.ts`** — Backend CDK infrastructure (`VitalisStack`): Cognito (auth), DynamoDB (single-table data store), S3 (PDF storage), API Gateway HTTP API (Cognito-authorized), EventBridge (workflow triggers), SNS (SMS), Amazon Textract (PDF processing), Amazon Polly (text-to-speech), Amazon Translate (localization), and 20+ Lambda functions under `lambda/`.
- **`lambda/doctors`, `lambda/patients`, `lambda/appointments`, `lambda/availability`** —
  REST-ish CRUD handlers behind API Gateway.
- **`lambda/pdf-intake`** — S3-triggered, runs Amazon Textract on uploaded lab
  PDFs, extracts key/value fields, writes a record, and emits a
  `lab_result_received` event.
- **`lambda/workflow-engine`** — the no-code automation core. Reads a workflow
  graph (trigger → conditions → actions → outputs) stored as JSON in
  DynamoDB and walks it whenever a matching trigger event arrives.
- **`lambda/notifications`** — SNS-based SMS sender, invoked by the workflow
  engine.
- **`state-machine/sample-lab-followup-workflow.json`** — an example workflow
  you can load into DynamoDB to test the engine end-to-end.
- **`lambda/prescriptions`** — doctor-only prescription PDF upload for a
  completed appointment; see "Prescription upload flow" below.

## Prescription upload flow

Once a doctor marks an appointment completed (`PUT /appointments/{id}` with
`{"status": "completed"}` — a small, separate code path in
`lambda/appointments/index.ts` next to the existing, intentionally-untouched
reschedule branch), they can upload a prescription PDF:

1. `POST /prescriptions/presign` — body `{appointmentId}`. Verifies the
   caller is in the `Doctors` group and is that appointment's `doctorId`,
   then returns a 300-second presigned S3 `PUT` URL. Prescription PDFs live
   in the **same** `pdfBucket` as lab-result PDFs (no new bucket), under the
   `prescriptions/<appointmentId>/<uuid>.pdf` key prefix — private, `BLOCK_ALL`,
   never made public.
2. Browser `PUT`s the file directly to that URL.
3. `POST /prescriptions/confirm` — body `{appointmentId, key, followUpSummary}`.
   Re-verifies doctor ownership, writes a `PRESCRIPTION#<id>` / `DETAILS`
   item (with a `GSI1PK = APPT_PRESCRIPTION#<appointmentId>` entry for
   appointment-scoped lookup), then calls the shared, idempotent
   `emitPrescriptionUploadedIfReady(appointmentId)` helper
   (`lambda/_shared/prescriptionEvent.ts`).
4. That helper checks (via a fresh `GetCommand`) that the appointment is
   `"completed"` **and** a prescription now exists for it; if so, it does a
   conditional `PutCommand` on an `APPT#<id>` / `EVENT_MARKER#prescription_uploaded`
   item (`ConditionExpression: attribute_not_exists(PK)`) and only on a
   successful write does it `PutEventsCommand` a `prescription_uploaded`
   event to the workflow bus. A `ConditionalCheckFailedException` from a
   losing concurrent/duplicate call is swallowed as "already emitted" — so
   the same helper is safe to call from both `lambda/appointments` (after
   marking completed) and `lambda/prescriptions` (after confirm), in either
   order, exactly once.
   - `DetailType`: `"prescription_uploaded"`
   - `Source`: `"vitalis.triggers"`
   - `Detail`: `{ appointmentId, patientId, doctorId, prescriptionId, followUpDueAt }`
     where `followUpDueAt` is `now + 3 days` (`FOLLOW_UP_DELAY_DAYS` in
     `lambda/_shared/prescriptionEvent.ts`).
5. `GET /prescriptions?appointmentId=...` / `GET /prescriptions/{id}` — the
   treating doctor or the patient themselves can read prescriptions for that
   appointment.

**IAM**: `prescriptionsFn` gets `table.grantReadWriteData`, `pdfBucket.grantPut`
(same bucket as `uploadsFn`, no new bucket policy needed), and
`workflowBus.grantPutEventsTo`. `appointmentsFn` already had
`workflowBus.grantPutEventsTo` from the existing booking-confirmation flow.

## Patient phone number and follow-up call consent

`Patient` profiles now carry three additional fields, set via
`PUT /patients/{id}`:

- **`phone`** must be in E.164 format (`+<countrycode><number>`, e.g.
  `+919876543210`) — validated server-side against
  `/^\+[1-9]\d{7,14}$/` (`lambda/patients/index.ts`, duplicated from
  `frontend/lib/constants.ts` since Lambdas don't share frontend files); an
  invalid phone returns `400`.
- **`followUpCallsEnabled`** — only ever persisted as `true` when the
  caller passes `followUpCallsEnabled: true` **and** the phone is valid
  E.164 **and** `consentGiven: true` was passed (the patient checked "I
  agree to receive automated healthcare follow-up calls on this number." in
  the frontend). Any other combination persists `false`.
- **`consentTimestamp`** / **`consentVersion`** — set to `new Date().toISOString()`
  and `"1.0"` respectively when `followUpCallsEnabled` computes `true`;
  cleared back to `null` otherwise.

## Automated follow-up calls (Amazon Connect + Amazon Lex V2)

Once an appointment is `completed` **and** a prescription has been uploaded
for it (the `prescription_uploaded` event — see "Prescription upload flow"
above), and the patient has opted in (`followUpCallsEnabled: true`, see
"Patient phone number and follow-up call consent"), Vitalis can place an
automated phone call to check how the patient is doing, offer to schedule a
follow-up appointment, and escalate to the doctor when needed. This is a
**real** implementation (not a logging stub) built on Amazon Connect (call
routing/telephony) + Amazon Lex V2 (the conversational bot) + Lambda (all
the actual logic and data access).

### New Lambdas

| Lambda | Trigger | Purpose |
|---|---|---|
| `lambda/outbound-call-initiator` | API: `POST /appointments/{id}/follow-up-call` (doctor's manual test button); direct invoke `{requestFollowUp:true,...}` from `workflow-engine`'s `call_patient` action; direct invoke `{followUpCallId}` for a raw dial/retry | Re-checks patient consent + appointment completed/prescription-uploaded state fresh, enforces one-active-call-per-appointment idempotency, calls `StartOutboundVoiceContact` with exponential-backoff retries (technical failures only, max 3 attempts) |
| `lambda/fetch-patient-context` | Invoked by the Connect contact flow | Resolves the 5 contact attributes into first name / doctor name / appointment type — **never** prescription contents or diagnosis |
| `lambda/lex-fulfillment` | Lex V2 code hook (DialogCodeHook + FulfillmentCodeHook) | The actual conversation branching logic (script steps A-H); see `lambda/lex-fulfillment/script.ts` for the pure, unit-tested intent→response mapping |
| `lambda/get-next-slots` | Invoked by `lex-fulfillment` | Read-only: next N open slots for a doctor |
| `lambda/reserve-slot-and-schedule` | Invoked by `lex-fulfillment` | Atomic conditional-write slot reservation + appointment creation (same open→held→booked pattern as `lambda/appointments`'s booking handler) |
| `lambda/notify-doctor` | Invoked by `lex-fulfillment` | Persists an in-app doctor notification (reuses the existing `NOTIFICATION#` item shape from `lambda/notifications`, plus a `DOCTOR_NOTIFICATIONS#<doctorId>` GSI1 entry) |
| `lambda/follow-up-calls` | API: `GET /follow-up-calls?appointmentId=...` | Read-only call status + audit timeline (doctors get the full timeline; patients get status only, never event detail or transcripts) |

### DynamoDB item shapes (same single table)

```
FOLLOWUP_CALL#<id>  / DETAILS
  { id, appointmentId, patientId, doctorId, prescriptionId, status,
    attempts, createdAt, GSI1PK: APPT_FOLLOWUP#<appointmentId>, GSI1SK: DETAILS }

FOLLOWUP_CALL#<id>  / EVENT#<isoTimestamp>#<eventName>
  { followUpCallId, event, detail, timestamp }
  # event is one of: requested | initiated | answered | verified |
  # intent_detected | appointment_offered | appointment_scheduled |
  # opted_out | failed | ended
  # `detail` holds only non-sensitive routing/outcome facts (intent name,
  # slot chosen, Connect contactId) — never raw audio or full transcripts.

NOTIFICATION#<id> / DETAILS   (reused item type, now also written by notify-doctor)
  { id, type, doctorId, appointmentId, patientId, followUpCallId, message,
    read, createdAt, GSI1PK: DOCTOR_NOTIFICATIONS#<doctorId>, GSI1SK: createdAt }
  # type is one of: persistent_symptoms | follow_up_requested |
  # emergency_symptoms | patient_unreachable
```

### The call script (steps A-H, `lambda/lex-fulfillment/script.ts`)

A. Intro + low-risk identity check (first name) — handled by the Connect
   flow / Lex's built-in slot-filling, not a custom intent.
B. "Are you feeling better, or does the problem still persist?"
C. **PatientIsFine** → thank-you message, end call.
D. **ProblemPersists** → offers to schedule a follow-up; notifies the doctor
   of persistent symptoms.
E. **ScheduleFollowUp** (yes) → `get-next-slots` for the same doctor, reads
   up to 3 options, `reserve-slot-and-schedule` atomically books the chosen
   one, confirms date/time/doctor/type.
F. **DeclineFollowUp** (no) → "contact your clinic" message, end call.
G. **EmergencySymptoms** → urgent-care message (911/ER), high-priority
   doctor notification, end call — **never** diagnoses or offers routine
   scheduling.
H. **FallbackIntent** (low confidence/silence) → repeats the prompt once,
   then offers transfer/callback, notifies the doctor the patient was
   unreachable, and ends safely.

Every turn re-checks `followUpCallsEnabled` directly from DynamoDB (not from
session state) before continuing — if the patient opted out mid-call, the
bot immediately says it can't discuss health information and ends.

### IAM

- `outboundCallInitiatorFn`: `connect:StartOutboundVoiceContact` (resource
  `*` — the Connect instance ARN can't be scoped without a dependency cycle,
  same reasoning as the existing Cognito post-confirmation trigger; see the
  comment in `lib/vitalis-stack.ts`).
- Connect instance has `lambda:InvokeFunction` on `fetch-patient-context`
  (`addPermission` with principal `connect.amazonaws.com`).
- The Lex bot's IAM role (`VitalisLexBotRole`, assumed by
  `lexv2.amazonaws.com`) can call `polly:SynthesizeSpeech`.
- Lex (both the test alias and the published "prod" alias) has
  `lambda:InvokeFunction` on `lex-fulfillment`.
- All new Lambdas get `table.grantReadWriteData`; `lex-fulfillment` gets
  `grantInvoke` on `notify-doctor`, `get-next-slots`, and
  `reserve-slot-and-schedule`; `workflow-engine` gets `grantInvoke` on
  `outbound-call-initiator`.

### What CDK provisions vs. what needs a manual console step

Per the installed `aws-cdk-lib` version's actual type defs (checked in
`node_modules/aws-cdk-lib/aws-connect` and `node_modules/aws-cdk-lib/aws-lex`
before writing any of this):

- **`AWS::Connect::Instance`** (`connect.CfnInstance`) — fully supported,
  provisioned by CDK.
- **`AWS::Lex::Bot`** (`lex.CfnBot`) — fully supported. Note: the CDK module
  is `aws-cdk-lib/aws-lex`, **not** a separate `aws-lexv2bot` module (no such
  module exists in this version) — `AWS::Lex::Bot` *is* the Lex V2 resource
  type despite the plain name. CDK provisions the bot, its 5 custom intents
  (`PatientIsFine`, `ProblemPersists`, `ScheduleFollowUp`, `DeclineFollowUp`,
  `EmergencySymptoms`) with sample utterances, and both a test alias and a
  published "prod" `CfnBotAlias`/`CfnBotVersion`, each wired to
  `lex-fulfillment` as the Lambda code hook.
  - **Deviation from spec**: `FallbackIntent` is **not** declared in
    `CfnBot`'s `intents` array — Lex V2 auto-provisions
    `AMAZON.FallbackIntent` for every bot locale, and that array is for
    custom intents only. It's configured/consumed (see `script.ts`'s
    `FallbackIntent` case), not declared.
- **`AWS::Connect::ContactFlow`** (`connect.CfnContactFlow`) — the `content`
  property genuinely accepts flow JSON as a plain string (content-as-code
  IS supported by this CFN resource). What's checked in is a minimal, real
  flow (invoke `fetch-patient-context`, then disconnect) — it does **not**
  include the "Get customer input (Amazon Lex)" block that hands the live
  call to the bot. That block's Connect Flow Language schema is intricate
  and its correctness can't be verified without a live console/API round
  trip, and — separately — it can't functionally work until the bot is
  *associated* with the Connect instance (next bullet), which CloudFormation
  also can't do. Hand-authoring it blind risked shipping something that
  looked complete but silently failed at runtime, so it's manual step 5
  below instead.
- **Not CloudFormation-representable at all**: claiming a phone number,
  associating a Lex V2 bot (alias) with a Connect instance
  (`connect:AssociateBot` — no `AWS::Connect::*` resource wraps this API in
  this CDK version), and publishing/activating a contact flow. These are the
  "commonly console/one-time-script steps even with CDK" the task spec
  anticipated.

### Manual console checklist (do this after `cdk deploy VitalisStack`, once)

1. **Claim a phone number** — Amazon Connect console → your instance →
   *Channels → Phone numbers → Claim a number*. Pick a number in your
   country/region (this is the one ongoing cost item in this whole feature —
   Connect bills per claimed number whether or not it's used, unlike
   everything else in this stack).
2. **Create a queue and routing profile referencing that number** (needed
   for outbound calls even without live agents) — *Routing → Queues → Add
   queue*, then *Routing → Routing profiles*, and set the queue's
   **Outbound caller ID number** to the number from step 1.
3. **Build and note the Lex bot's IDs** — `CfnOutput`s `LexFollowUpBotId` /
   `LexFollowUpBotAliasId` from `cdk deploy` output already give you these;
   confirm in the Lex console (*Amazon Lex → vitalis-follow-up-call-bot*)
   that the "prod" alias shows **Built** (CDK's `autoBuildBotLocales: true`
   should already trigger this, but Lex builds are asynchronous — wait for
   it to finish, or click **Build** manually, before continuing).
4. **Associate the bot with the Connect instance** — Connect console → your
   instance → *Flows → Amazon Lex* → **Add Lex Bot**, choose
   `vitalis-follow-up-call-bot`, alias `prod`, region matches your deploy
   region. (This is the `connect:AssociateBot` call CloudFormation has no
   resource for.)
5. **Add the Lex block to the contact flow** — Connect console → *Flows* →
   open `vitalis-follow-up-call` (created by CDK) → drag in a **"Get
   customer input"** block configured to use **Amazon Lex V2**, select the
   bot/alias from step 4, and wire it in after the existing "Invoke AWS
   Lambda function" (`fetch-patient-context`) block, before disconnect. Save
   and **Publish** the flow (unpublished flow edits aren't live).
6. **Update `outboundCallInitiatorFn`'s env vars if you changed anything
   above** — `CONNECT_INSTANCE_ID` and `CONNECT_CONTACT_FLOW_ID` are already
   wired from CDK outputs automatically; you only need to touch these by
   hand if you created a *second* contact flow instead of editing the
   CDK-created one, or reference a different Connect instance.
7. **Test it**: as a doctor, mark an appointment `completed`, upload a
   prescription, ensure the patient has `followUpCallsEnabled: true` with a
   real phone number in their profile, then use the doctor appointments
   page's **"Start follow-up call"** button (or `POST
   /appointments/{id}/follow-up-call`). Watch `FOLLOWUP_CALL#<id>` items and
   the CloudWatch log group for `lex-fulfillment` to confirm the call
   connects and the bot responds.

## Deliberately not built yet

- **Video consultations** — The data model exists, but the Chime SDK integration for live video is not yet implemented
- **Calendar integration** — Google Calendar sync is stubbed; can be added once you have OAuth credentials
- **Advanced scheduling** — Scheduled follow-up calls via Step Functions or EventBridge Scheduler (currently calls fire immediately after prescription upload)

## Setup

```bash
npm install
npx cdk bootstrap   # one-time per AWS account/region
npm run deploy
```

You'll need AWS credentials configured locally (`aws configure` or an
`AWS_PROFILE` env var) with permissions to create the resources above. After
`cdk bootstrap` you may see a small S3/ECR bootstrap stack — that's normal
and CDK's own doing, not part of this app.

On success, CDK prints outputs including `ApiUrl`, `UserPoolId`,
`UserPoolClientId`, `TableName`, `PdfBucketName`, and `WorkflowBusName`.

## Trying the workflow engine

1. Deploy the stack.
2. Load the sample workflow into DynamoDB (swap in your table name from the
   CDK output):
   ```bash
   aws dynamodb put-item \
     --table-name vitalis-table \
     --item file://state-machine/sample-lab-followup-workflow.json
   ```
   (You'll need to convert the plain JSON to DynamoDB's typed attribute
   format, or use `aws dynamodb put-item --table-name vitalis-table \
   --item "$(node -e "...")"` — happy to generate a small loader script if useful.)
3. Upload a PDF with a "Cholesterol" field to the `vitalis-pdf-intake-*`
   bucket — Textract runs automatically, and if the extracted value is over
   240 the workflow engine fires the `send_sms` and `schedule_appointment`
   (logged) actions and records a run in the `WORKFLOW#sample-lab-followup`
   partition.

## Cost Model

Vitalis operates on AWS's pay-per-use serverless model, meaning you only pay for what you use:
- **Lambda** — per 1M invocations + GB-seconds of compute
- **DynamoDB** — per read/write unit (on-demand mode, no provisioning required)
- **API Gateway HTTP** — per million requests
- **S3** — per GB stored + per request
- **SNS** — per SMS sent
- **Textract** — per page analyzed (~$0.015 per page)
- **Cognito** — free up to 10,000 monthly active users

At typical clinic usage (dozens of appointments and workflows daily), costs are typically under $50/month. The infrastructure scales automatically from zero to high load with no configuration.

## Next Steps & Roadmap

### High Priority
1. **Appointment Reschedule UI** — Currently marked as completed in the database but the `PUT /appointments/{id}` endpoint is stubbed
2. **Add Ownership Checks** — Doctor/patient can only view/cancel their own appointments (currently any authenticated user can access any appointment by ID)
3. **Scheduled Follow-up Calls** — Implement Step Functions or EventBridge Scheduler to delay calls until `followUpDueAt` instead of immediately after prescription upload
4. **Connect/Lex Setup** — Complete the manual console configuration (phone number claim, bot association, contact flow Lex block)

### Medium Priority
1. Google Calendar integration for appointment syncing
2. Chime SDK video consultation room (data model exists, media layer needed)
3. Doctor notification dashboard (in-app alerts for follow-up call outcomes)
4. Advanced workflow builder UI for custom automations

### Polish & Operations
1. Add comprehensive logging and monitoring
2. Set up CloudWatch dashboards for operational metrics
3. Create runbooks for common operations (adding doctors, handling call failures)
4. Add end-to-end tests for critical workflows
