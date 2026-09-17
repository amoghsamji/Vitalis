# Vitalis — AWS-native healthcare workflow automation

Serverless skeleton for the platform described in `CareSync_AI_Features.md`,
rebuilt on AWS-managed services instead of Supabase/ElevenLabs/Twilio/Daily.

## What's here

- **`bin/vitalis.ts` / `lib/vitalis-stack.ts`** — the single AWS CDK stack:
  Cognito (auth), DynamoDB (single-table data store), S3 (PDF intake),
  API Gateway HTTP API (Cognito-authorized), EventBridge (workflow triggers),
  SNS (SMS), and 7 Lambda functions.
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

## Why these AWS services (mapped from the original feature spec)

| Original | Here |
|---|---|
| Supabase Auth | Cognito User Pools (Doctors/Patients groups) |
| Supabase Postgres | DynamoDB (on-demand billing) |
| pdfplumber/pdfminer | Amazon Textract |
| ElevenLabs + Twilio (voice) | Left as a clearly marked seam in `workflow-engine/index.ts` (`call_patient` action) — see "Deliberately not built" below |
| Daily/100ms/Twilio (video) | Seam for Amazon Chime SDK (not yet implemented) |
| React Flow + Dagre canvas | Unchanged — this is a frontend concern; the graph JSON shape here matches what that canvas would produce |
| FastAPI backend | API Gateway + Lambda (Node/TypeScript) |

## Deliberately not built yet (cost/complexity guardrails for a $100 budget)

- **No outbound voice calling.** Amazon Connect requires a claimed phone
  number that bills whether or not you use it. The `call_patient` workflow
  action just logs — wire in Connect, Pinpoint Voice, or your existing
  ElevenLabs/Twilio account when you're ready to spend on that specific piece.
- **No video consult backend (Chime SDK) yet** — the consultation room only
  has a data model, not live media.
- **No Google Calendar integration wired up yet** — `schedule_appointment`
  is a logged seam; add a `google-calendar` Lambda once you have OAuth
  credentials for it.
- ~~No CloudFront/Amplify frontend hosting stack yet~~ — see
  [`frontend/`](frontend/README.md): a statically-exported Next.js app on
  S3 + CloudFront (`VitalisFrontendStack`), covering sign-up/sign-in,
  doctor directory + booking, patient/doctor profiles, availability
  management, and lab-PDF upload against the existing API.

Everything that *is* built only bills per request/per GB — nothing runs
while idle, so sitting on this stack between work sessions costs close to $0.

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

## Estimated cost against your $100 credit

At low/dev-level usage (a handful of bookings, PDF uploads, and workflow
runs per day), this stack should run **a few dollars a month at most** —
Lambda, DynamoDB on-demand, API Gateway HTTP API, S3, EventBridge, and SNS
are all pay-per-use with generous free tiers. The two things to watch if you
scale up testing:
- **Textract** — priced per page analyzed (a few tenths of a cent per page,
  but it adds up with heavy PDF testing).
- **Cognito** — free for the first 10,000 MAUs, so a non-issue at dev scale.

Run `npx cdk destroy` when you're done for a session if you want to be
extra safe with the credit — everything here is defined in code and
redeploys in a couple of minutes.

## Next steps (pick what to build next)

1. Google Calendar integration Lambda
2. Chime SDK video consultation room
3. Voice-calling integration (Connect/Pinpoint or keep ElevenLabs+Twilio)
4. A `workflows` CRUD API route so the React Flow canvas can save/load graphs
   through API Gateway instead of direct DynamoDB writes
5. Fix the `PUT /appointments/{id}` no-op bug and add a reschedule UI
6. Add an ownership check to `lambda/appointments/index.ts` so a caller can
   only view/cancel their own appointments
