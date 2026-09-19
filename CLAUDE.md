# Vitalis — context for Claude Code

Read this first when starting a new session in this repo. It's a handoff
from a prior session so a fresh session (e.g. in the VS Code extension) has
the same context without re-deriving it.

## What this project is

Vitalis is an enterprise-grade, AWS-native healthcare workflow automation and telehealth platform, built from scratch targeting a
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
  **This AWS account currently can't create CloudFront distributions**
  ("account must be verified... contact AWS Support" — a fraud-prevention
  hold on new accounts, confirmed via an actual deploy attempt) — see
  "Deployment status" below for the S3-website fallback in use until that's
  lifted.

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

**Verified locally at the time**: `npm run build` (root tsc), `npx cdk synth`
for both stacks, and `cd frontend && npm run build` all succeeded. Both
stacks have since actually been deployed — see "Deployment status" below,
which supersedes the "not yet deployed" framing this paragraph originally had.

## Since that session: call providers + prescriptions (uncommitted as of this
## writing — see `git status`)

Amazon Connect (for automated follow-up calls) turned out to be unusable on
this AWS account: it's billed through AISPL (the India-billed reseller
entity), and AISPL accounts are blocked from creating Amazon Connect
instances in every region — confirmed by an actual deploy attempt, not
assumed. `lib/vitalis-stack.ts` now supports three interchangeable follow-up
call providers, picked at deploy time via CDK context (never guessed if more
than one flag is set — see the `resolvedCallProvider` logic):

- `-c enableConnectLex=true` — the original Connect+Lex path. **Unusable on
  this account** (see above); kept in case the AISPL billing relationship is
  ever migrated.
- `-c enableChimeVoice=true` — Amazon Chime SDK Voice, AISPL-compatible.
  Needs a custom resource (`lambda/chime-sma-provisioner`) since this
  aws-cdk-lib version has no native `AWS::ChimeSDKVoice::*` CloudFormation
  support.
- `-c enableTwilioVoice=true -c twilioAccountSid=... -c twilioAuthToken=...
  -c twilioPhoneNumber=... -c geminiApiKey=...` — Twilio Voice + Gemini
  (`lambda/twilio-voice`), fully independent of Connect/Lex/Chime. **This is
  the provider currently deployed** — see "Deployment status" below.

Also added since that session: digital (non-PDF) prescription issuance with
Polly read-aloud and Translate, doctor/patient prescription-list routes, and
a Lex `FallbackIntent` fix required for the bot's CloudFormation import to
succeed at all (undocumented Lex V2 requirement, found via a real deploy
failure).

## Known gaps (raised with the user, deliberately not fixed this pass)

- `PUT /appointments/{id}` in `lambda/appointments/index.ts` is a no-op bug
  (`if_not_exists` on fields that already exist) — user chose to skip
  reschedule rather than fix it, so there's no reschedule UI.
- `lambda/appointments/index.ts` has no ownership check — any authenticated
  caller can view/cancel any appointment by ID. Not exploitable via the
  frontend today (it never exposes another user's appointment ID), but worth
  fixing before wider access. Listed in README's "Next steps".
- Hard navigation to any non-root route (typing the URL, refreshing mid-route,
  opening a shared/bookmarked link, e.g. `/login` or `/doctor/appointments`)
  404s on both hosting paths — confirmed on the live S3-website fallback, and
  it would affect the CloudFront+OAC path too since OAC talks to S3's REST
  API, which (unlike the S3 website endpoint) does no per-directory
  index-document resolution; there's no CloudFront Function/Lambda@Edge doing
  that rewrite. Normal in-app usage is unaffected: Next's client router
  navigates via prefetched `<route>.txt` RSC-payload files (real objects,
  fetched by exact name), not via the server resolving the path. Not fixed
  since it wasn't blocking the deploy — worth a CloudFront Function
  (`uri.replace` to append `.html`/`index.html`) once CloudFront is available.

## Deployment status

**Both stacks are live in `us-east-1`, account `401528908325`** (deployed by
Claude Code with the user's AWS root-account credentials, logged in via
`aws login` — a custom wrapper around AWS CLI v2, not a standard `aws sso
login`/IAM setup).

- `VitalisStack`: deployed with `-c enableTwilioVoice=true` plus the four
  Twilio/Gemini context values (given by the user directly in chat — not
  stored anywhere in this repo; re-supply them for any future deploy that
  needs to keep Twilio calling enabled, or CDK will plan to remove those
  resources).
- `VitalisFrontendStack`: deployed with `-c enableS3WebsiteFallback=true`
  (see the Architecture section above) since CloudFront is blocked pending
  AWS Support verification. `SiteUrl` output is the S3 static-website
  endpoint (plain HTTP, no HTTPS) — check the live stack output for the
  current URL rather than trusting any URL written in chat history, since
  redeploying can change the bucket's physical name.
- **Follow-up action for the user**: open an AWS Support case referencing
  the CloudFront `AccessDenied`/"account must be verified" error to lift the
  hold, then redeploy `VitalisFrontendStack` *without*
  `-c enableS3WebsiteFallback` to switch to the intended CloudFront+HTTPS
  setup (same `frontend/out` contents, just a different front door — no
  rebuild needed, just a plain `cdk deploy`).
- CDK asset-publish/deploy roles (`cdk-hnb659fds-*`) can't be assumed by
  these credentials ("current credentials could not be used to assume
  [role]... proceeding anyway") — non-fatal, CDK falls back to the
  root-account credentials directly, but it's a sign this account's CDK
  bootstrap trust policy is nonstandard. Ignore the warning unless a deploy
  actually fails on a permissions error.

## Plan file from this session

The original plan (approved before implementation) is saved at
`C:\Users\Amogh\.claude\plans\check-with-the-vitals-atomic-clarke.md` on the
machine that ran that session — not part of this repo, so it won't be
present in a fresh VS Code checkout. The summary above supersedes it as the
source of truth for what actually landed.
