# Vitalis — context for Claude Code

Read this first when starting a new session in this repo. It's a handoff
from a prior session so a fresh session (e.g. in the VS Code extension) has
the same context without re-deriving it.

## What this project is

Vitalis is an AWS-native rebuild of a CareSync-style healthcare workflow
platform (originally scoped as Supabase/ElevenLabs/Twilio/Daily), targeting a
~$100 AWS credit budget. Everything is deliberately serverless/pay-per-use —
no NAT Gateway, no RDS/Aurora, no Amazon Connect phone numbers — so nothing
bills while idle. See [README.md](README.md) for the full feature-to-service
mapping and [frontend/README.md](frontend/README.md) for the frontend.

The original architecture decisions came from a shared claude.ai chat
(not in this repo) that scoped the AWS service choices. That chat ended on
"add frontend hosting, or wire in a stubbed integration (Google Calendar /
Chime) first?" — frontend hosting was chosen, which is what the most recent
session (summarized below) built.

## Architecture

Two CDK stacks, deployed independently, defined in TypeScript
([bin/vitalis.ts](bin/vitalis.ts)):

- **`VitalisStack`** ([lib/vitalis-stack.ts](lib/vitalis-stack.ts)) — backend.
  Cognito (auth), DynamoDB (single-table store), S3 (PDF intake), API
  Gateway HTTP API (Cognito-JWT-authorized), EventBridge (workflow triggers),
  SNS (SMS), Textract (PDF OCR), and 9 Lambda functions under `lambda/`.
- **`VitalisFrontendStack`** ([lib/frontend-stack.ts](lib/frontend-stack.ts))
  — S3 (private, OAC) + CloudFront serving a statically-exported Next.js app
  from `frontend/out`. No server compute at rest, matching the backend's
  cost philosophy. `BucketDeployment` auto-syncs and invalidates on deploy.

The frontend is a fully separate `frontend/` npm project (own
`package.json`), a Next.js 14 App Router app using `output: "export"`. It's
excluded from the root `tsconfig.json` build. See
[frontend/README.md](frontend/README.md) for its structure, auth model, and
build/deploy order (backend must be deployed first so the frontend can bake
`NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_USER_POOL_ID`/`NEXT_PUBLIC_USER_POOL_CLIENT_ID`
into the static build).

## What the most recent session did

Starting point: a backend-only skeleton existed (Cognito/DynamoDB/Lambda/API
Gateway/EventBridge/SNS/Textract), described in the original README, with no
frontend and two undiscovered gaps.

1. **Added a presigned-URL upload endpoint** — `lambda/uploads/index.ts`,
   routed as `POST /uploads/lab-pdf`. Needed because there was no way for a
   browser to actually upload a lab PDF (the S3 bucket had CORS but nothing
   handed out credentials/a presigned URL). The existing `pdf-intake`
   S3-trigger Lambda is unchanged.
2. **Added a Cognito Post-Confirmation trigger** —
   `lambda/post-confirmation/index.ts`. Self-signup users were never added to
   the `Doctors`/`Patients` Cognito groups, which broke the `isSelfOrDoctor`
   check in `lambda/patients/index.ts` (a doctor could never view a
   patient's record). The trigger reads the `custom:role` attribute set at
   signup and calls `AdminAddUserToGroup`.
3. **Built the full frontend** under `frontend/` — sign-up (with role
   picker)/sign-in, doctor directory + booking, patient & doctor profiles
   (conditions/medications/PDF upload), availability management, appointment
   lists. Auth via `amazon-cognito-identity-js` (chosen over full
   `aws-amplify` to keep the bundle light).
4. **Fixed three pre-existing bugs found along the way** (not part of the
   original ask, but blocked compilation/synth entirely):
   - A JSDoc comment in `lib/vitalis-stack.ts` contained `lambda/*/...`,
     whose `*/` terminated the comment block early and broke the whole file.
   - `ConditionalCheckFailedException` was imported from
     `@aws-sdk/lib-dynamodb` (wrong package) in
     `lambda/appointments/index.ts` and `lambda/availability/index.ts`; it
     lives in `@aws-sdk/client-dynamodb`.
   - Root `tsconfig.json` had no `frontend` exclusion, so the root `tsc`
     build tried (and failed) to compile the Next.js app with the wrong
     compiler options.
5. **Added `esbuild` as a devDependency** so CDK's `NodejsFunction` bundles
   Lambdas locally instead of falling back to Docker.

**Verified locally** (not yet deployed to AWS): `npm run build` (root tsc),
`npx cdk synth` for both stacks (using a temporary placeholder
`frontend/out` for the frontend stack, since real output only exists after
`next build`), and `cd frontend && npm run build` (Next static export, with
placeholder env vars) all succeed. No AWS credentials have been used or
configured by Claude — deployment is entirely the user's action to take.

## Known gaps (raised with the user, deliberately not fixed this pass)

- `PUT /appointments/{id}` in `lambda/appointments/index.ts` is a no-op bug
  (`if_not_exists` on fields that already exist) — user chose to skip
  reschedule rather than fix it, so there's no reschedule UI.
- `lambda/appointments/index.ts` has no ownership check — any authenticated
  caller can view/cancel any appointment by ID. Not exploitable via the
  frontend today (it never exposes another user's appointment ID), but worth
  fixing before wider access. Listed in README's "Next steps".

## Deployment (not yet done)

See the root [README.md](README.md) "Setup" section and
[frontend/README.md](frontend/README.md) "Build order" for exact commands.
Short version: `aws configure` → `npx cdk bootstrap` → `npx cdk deploy
VitalisStack` → fill `frontend/.env.production` from its outputs → `cd
frontend && npm run build` → `npx cdk deploy VitalisFrontendStack`.

## Plan file from this session

The original plan (approved before implementation) is saved at
`C:\Users\Amogh\.claude\plans\check-with-the-vitals-atomic-clarke.md` on the
machine that ran that session — not part of this repo, so it won't be
present in a fresh VS Code checkout. The summary above supersedes it as the
source of truth for what actually landed.
