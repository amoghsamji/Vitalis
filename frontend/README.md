# Vitalis frontend

Next.js (App Router) app, statically exported and served from S3 + CloudFront
(see [`lib/frontend-stack.ts`](../lib/frontend-stack.ts)) — no server compute
at rest, matching the backend's pay-per-use design.

## Build order

The static export needs the backend's API URL and Cognito IDs baked in at
build time, so deploy the backend stack first.

```bash
# from the repo root, once
npm install
npx cdk bootstrap
npx cdk deploy VitalisStack
```

Copy the `ApiUrl`, `UserPoolId`, and `UserPoolClientId` from that stack's
outputs into `frontend/.env.production` (copy `.env.example` as a starting
point):

```bash
cd frontend
npm install
cp .env.example .env.production   # fill in the three values
npm run build                     # produces frontend/out
```

Then deploy the frontend stack, which uploads `frontend/out` to S3 and
invalidates CloudFront automatically:

```bash
cd ..
npx cdk deploy VitalisFrontendStack
```

The `SiteUrl` output is your CloudFront domain.

## Google sign-in

Create an OAuth web client in Google Cloud. Add the Cognito callback URL
`https://vitalis-<account-id>-<region>.auth.<region>.amazoncognito.com/oauth2/idpresponse`
to its authorised redirect URIs. Then deploy the backend with the Google
credentials and the final frontend login URL:

```bash
npx cdk deploy VitalisStack \
  -c oauthRedirectUrl=https://your-site.example.com/login \
  -c googleClientId=... \
  -c googleClientSecret=...
```

Set `NEXT_PUBLIC_COGNITO_DOMAIN` from the `CognitoDomain` stack output and
`NEXT_PUBLIC_OAUTH_REDIRECT_URI` to that same `/login` URL before rebuilding
the frontend. The single Sign in button opens Cognito Hosted UI, where users
can sign in, sign up, or continue with Google. Google-created users start as
patients; create doctors through the normal sign-up flow so they can select
their role.

## Local development

```bash
cd frontend
npm run dev
```

Requires `.env.local` (or `.env.production`) with the same three
`NEXT_PUBLIC_*` variables, pointed at an already-deployed backend — there's
no local mock of the API or Cognito.

## Auth model

- Sign-up collects a `custom:role` attribute ("doctor" | "patient"). A
  Cognito Post-Confirmation Lambda trigger (`lambda/post-confirmation`) adds
  the confirmed user to the matching `Doctors`/`Patients` Cognito group.
- The frontend derives role from the `cognito:groups` claim on the ID token
  after sign-in, and uses that ID token as a `Bearer` token against the API.
- A brand-new doctor/patient has no `PROFILE` item in DynamoDB yet — the
  profile pages treat a 404 from `GET /doctors/{id}` / `GET /patients/{id}`
  as "new user, show a blank form", and the first `PUT` creates the record.

## Known gaps carried over from the backend (not fixed in this pass)

- `PUT /appointments/{id}` is a no-op (see `lambda/appointments/index.ts`),
  so there's no reschedule UI — only book and cancel.
- `lambda/appointments/index.ts` doesn't check that the caller owns an
  appointment before letting them view/cancel it by ID; the frontend never
  exposes another user's appointment ID, but this is a backend gap worth
  knowing about before wider access.
