# Cloud Run / Firebase operations

Project: `vibecodingjapan`. The application reuses existing Firebase Auth email/password users. There is no signup UI. Existing providers, Auth users, Firebase rules and other services are unchanged. Images remain externally generated and manually uploaded.

## Scale to zero

Cloud Run service `ai-director`, Tokyo (`asia-northeast1`), uses request-based billing, **minimum 0**, maximum 1 instance, 2 CPU, 2 GiB, concurrency 8, and 1800-second request timeout. No instance is kept permanently warm. Cold starts are expected. Running tasks, Storage, network transfer, build artifacts and inference still incur usage charges.

Cloud Tasks queue `ai-director` invokes the authenticated internal worker. Long-running work stays inside a live worker HTTP request; nothing relies on CPU after returning an HTTP response. The browser can close after submission. Script tasks run generation and validation. Video tasks check the upstream provider every 30 seconds, up to 240 checks, then download the result, mux original narration and save the MP4. The source video and narration remain available for repair.

Script workers claim the job with a Storage generation precondition before calling a paid model. An interrupted, ambiguous model call is marked failed instead of silently resubmitting. Video submission similarly creates a persistent request-ID record before uploading or calling the provider. Retrying that same request ID returns the existing record. Download and mux retries never regenerate the upstream video.

Do not raise maximum instances without reviewing cross-instance leases, project update conflicts and FFmpeg concurrency. For videos beyond the automatic polling window, opening the project can query the existing job ID again. If submission is ambiguous, check the ai& console before creating another paid request.

## Storage and identity

Bucket: `vibecodingjapan.firebasestorage.app`. The existing bucket is in US East; Cloud Run is in Tokyo, so cross-region transfer and latency apply. Existing data is not moved.

```
ai-director/users/<base64url(firebase uid)>/
  projects/<project-id>.json
  projects/<project-id>.summary.json
  images/<project-id>/<character-id>.image
  images/<project-id>/<character-id>.image.json
  scripts/<job-id>.json
  scripts/<job-id>.claim.json
  audio/<hash>.mp3
  videos/<request-id>.json
  videos/<request-id>.provider.mp4
  videos/<request-id>.narration.mp3
  videos/<request-id>.mp4
  videos/<request-id>.reference-<n>.image
```

The existing Firebase rules already deny client access to this new prefix. All access goes through the backend after verifying the user's Firebase session. No public object ACLs, Firebase download tokens or long-lived signed URLs are created. Media is uploaded before completion is acknowledged; local scratch files can be lost without losing completed media. Browser caches are also scoped by UID. Project edits save automatically and have a manual cloud-save button. JSON and ZIP exports remain available.

The dedicated service account is `ai-director-run@vibecodingjapan.iam.gserviceaccount.com`:

- Custom `aiDirectorSession` role: `firebaseauth.users.get` and `firebaseauth.users.createSession` only.
- Bucket `storage.objectAdmin`, conditional on the `ai-director/` object prefix; bucket-level evaluation allows object listing.
- `cloudtasks.enqueuer` only on the application queue.
- `iam.serviceAccountUser` only on itself, for the task's OIDC identity.
- `secretmanager.secretAccessor` only on `ai-director-aiand-key`.

The public service serves the login page. Application APIs require verified Firebase session cookies. Internal workers require a Google OIDC token with the configured audience and the worker's verified service-account email. The browser exchanges a recent Firebase ID token for an HttpOnly, Secure, SameSite=Strict cookie, with CSRF and same-origin checks. API requests check session revocation and disabled users. Logout clears the browser session. No private service credentials are embedded in the frontend bundle; Firebase Web configuration is public.

## Build / redeploy

`Dockerfile` includes Node 24, Python, pinned Edge TTS, FFmpeg/ffprobe and the project-local Skill. Director generation uses ai& HTTPS directly and does not require a local aiand binary or personal Skills folder.

Retrieve the existing public Firebase Web config:

```sh
npx -y firebase-tools@latest apps:sdkconfig WEB 1:153532166169:web:acd73423cf17844176fa88 \
  --project vibecodingjapan --json > /tmp/ai-director-firebase-config.json
```

Review the provisioning script before using it in a different environment: it changes scoped IAM and uploads the local AIAND key to Secret Manager. Existing enabled secret versions are retained; keys are never printed.

```sh
node scripts/provision-cloud.mjs
DEPLOY_ENV_FILE=/tmp/ai-director-cloud-env.json scripts/deploy-cloud-run.sh
```

The runtime config contains public Firebase configuration and resource names; `SERVICE_URL` must match the deployed URL and the Cloud Tasks audience. `.env.example` lists variables. `K_SERVICE` enforces cloud mode on Cloud Run. Local-only mode remains available when no cloud flags are set. `.env`, credentials, local runtimes, generated media and personal files are excluded from Docker and Cloud Build context.

## Verification and limits

```sh
npm test
npm run test:skills
npm run skills:verify
npm run build
```

Tests cover unsigned requests, CSRF, revoked sessions, cross-user access, persistent images and projects, loss of all local video files, OIDC task identity, worker deduplication and prior media behavior.

Cloud video requests accept at most 24 MiB total JSON, below Cloud Run's request limit. Each character image accepts at most 10 MiB. Project saves upload images separately and retain authenticated audio/video URLs, plus portable embedded narration when supplied by imported files. The current UI supports existing email/password users; Google login is available only if explicitly enabled in both Firebase and runtime configuration.
