# Rani Pharma Achievers — Firebase + Vercel setup

> **URGENT SECURITY STEP:** A Firebase Admin service-account JSON was present in the files shared for review. Treat that private key as exposed: revoke/delete that key in Google Cloud IAM/Firebase Service Accounts, generate a replacement, and update Vercel's `FIREBASE_SERVICE_ACCOUNT_JSON` environment variable before deployment. Do not put the JSON in this project or ZIP.

This package keeps the supplied HTML/CSS and page layout unchanged while connecting the existing student and faculty portals to Firebase Authentication, Firestore through a protected Vercel API, and server-side test scoring. It is a **deployment candidate, not a live-system guarantee**: the actual Firebase project and Vercel environment must be configured and tested before real students use it.

## What is included

- `ranipharmalogin2.html`, `fac.html`, `raniwaitingpage.html`, `test.html`: existing page designs with API/auth wiring.
- `firebase-client.js`: Firebase web config, register-number/ID mapping, auth-state readiness, login and password-change helpers.
- `api/[[...path]].js`: server-side Firebase Admin API for accounts, tests, question bank, autosaving, submission, scoring and results.
- `firestore.rules`: blocks direct browser access to Firestore; the trusted API uses the Admin SDK.
- `firestore.indexes.json` and `firebase.json`: required composite indexes and Firebase CLI configuration.
- `scripts/import-students.mjs`: one-time CSV/JSON migration into Firebase Authentication and matching Firestore student profiles. The source contains plaintext initial passwords; keep it private and never commit or deploy it.
- `vercel.json`, `package.json`: routing and server dependencies.

## 1. Back up before deployment

1. Download and keep a backup of the current working Vercel project/source.
2. Do **not** delete the current project or switch the production domain yet.
3. Test this package in a separate Vercel Preview deployment first.

## 2. Firebase Authentication

1. Open Firebase Console → project `ranipharma` → **Authentication** → **Sign-in method**.
2. Enable **Email/Password**.
3. In Authentication → Settings → Authorized domains, confirm `ranipharmaachievers.com` and `www.ranipharmaachievers.com` are listed. The Firebase auth domain `ranipharma.firebaseapp.com` should also remain available.
4. Passwords are stored only in Firebase Authentication, never in Firestore.

## 3. Firestore database, rules and indexes

1. Confirm Firestore Database exists in project `ranipharma` and use the default database `(default)`.
2. Install/use the Firebase CLI and sign in with an account that has permission to deploy Firestore rules/indexes.
3. From this folder, run `firebase use ranipharma` if the project alias is not selected, then run:

   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```

4. Wait for the composite indexes to finish building before testing queries. Firestore index builds can take several minutes.
5. The included rules deny all direct client reads/writes. Do not loosen them to `allow read, write: if true`; the API accesses Firestore using the server-only Admin SDK.

## 4. Required Vercel secret

1. Firebase Console → Project settings → Service accounts → generate a private key.
2. In the intended Vercel project → Settings → Environment Variables, create `FIREBASE_SERVICE_ACCOUNT_JSON` and paste the entire service-account JSON as one value.
3. Select Preview first. Add Production only after Preview tests pass.
4. Never paste the service-account JSON into any HTML/JavaScript file, Git repository, screenshot, or chat. If the private key is exposed, revoke it in Firebase/Google Cloud and create a new one.
5. Redeploy the Preview deployment after adding the variable. The server must use a service account from project `ranipharma`.

## 5. First faculty account (required before faculty login)

The faculty login cannot work until both Firebase Authentication and the matching Firestore user profile exist.

1. In Firebase Authentication, manually create the first faculty account with the email generated from their faculty ID using the convention below. Choose a temporary password and share it securely.
2. Copy the new user's **UID**.
3. In Firestore, create `users/{UID}` with fields like:

   ```json
   {
     "uid": "PASTE_THE_REAL_AUTH_UID",
     "role": "faculty",
     "facultyId": "RPA-FAC-001",
     "name": "Faculty Admin",
     "active": true
   }
   ```

   Replace the sample UID, faculty ID and name with the real values. Do not set a student account's role to `faculty`.

## 6. Register-number login mapping

The user types their register number/faculty ID and password. The client and server both convert the identifier to the same internal Firebase email:

- Student: `r-<encoded-id>@students.ranipharmaachievers.com`
- Faculty: `f-<encoded-id>@faculty.ranipharmaachievers.com`

The identifier is trimmed, uppercased, lowercased for the email, and each non-alphanumeric character becomes `-` plus its lowercase hexadecimal character code. For example, `RPA-FAC-001` becomes `f-rpa-2dfac-2d001@faculty.ranipharmaachievers.com`.

Student accounts created from the faculty portal use this convention. Any pre-existing Firebase users must be checked/migrated so their Auth email matches this convention and their `users/{UID}` document has `role: "student"`, `regNo`, `name`, and `active: true`.

## 7. Firestore collections and data ownership

The API uses these collections:

- `users/{uid}` — portal role, register/faculty ID, name, active flag and account metadata. Firebase Auth is the source of password truth.
- `tests/{testId}` — name, ISO `slotStart`, duration, negative marks, questions and creator metadata. Correct answers are returned only to faculty/server workflows, never to a student's test payload before submission.
- `questionBank/{questionId}` — faculty-managed question text, four options, correct option index, topic and marks.
- `attempts/{uid_testId}` — one attempt per student per test, saved answers, start/submission state and server-computed score.

Do not manually type passwords into Firestore. The server verifies the Firebase ID token and the `users/{uid}` role for every protected API request. Scoring is performed server-side; the browser cannot set the final score.

## 8. Import student accounts

Prepare a private CSV or JSON file containing register number, student name, and initial password. Firebase Authentication does not use that file directly, so run the migration script locally to create Firebase Auth users and matching `users/{UID}` Firestore profiles. **Passwords are never written to Firestore.**

1. Confirm Email/Password sign-in is enabled and the service-account JSON belongs to project `ranipharma`.
2. Open Terminal in this project folder. Set `FIREBASE_SERVICE_ACCOUNT_JSON` to the complete service-account JSON as a shell environment value; do not paste it into any source file.
3. Install dependencies with `npm install`.
4. Use a CSV header such as `regNo,name,password`, or a JSON array with those fields.
5. Run `node scripts/import-students.mjs /absolute/path/to/student-records.csv` (JSON is also accepted).
6. Check the printed summary. The script is safe to rerun: it does not reset passwords for accounts that already exist, and it repairs missing/mismatched Firestore profiles. Existing Firebase accounts keep their current password; the source password only initializes newly created accounts.
7. Confirm the summary has zero failures. Resolve any failures before student login testing.

The student records file is not included in this folder. Keep it outside the project where possible. The included ignore files also exclude common `student-records*.csv/json` names. Since it contains plaintext initial credentials, delete extra copies when migration and verification are complete, and distribute passwords securely.

## 9. Deploy to Vercel Preview

1. Put the contents of this folder in a separate branch or Preview project first; do not overwrite/delete the existing live project as your first test.
2. Ensure the Vercel project root contains `package.json`, `vercel.json`, `firebase-client.js`, all four HTML files and the `api` folder.
3. Vercel installs the `firebase-admin` dependency from `package.json`. Confirm `FIREBASE_SERVICE_ACCOUNT_JSON` is present for the Preview environment, then deploy.
4. Check that `/`, `/faculty`, `/waiting`, `/test` load the same original design and that `/api/auth/me` returns JSON rather than an HTML 404 when called from an authenticated portal page.

## 10. Required end-to-end test checklist

Use disposable accounts and fake questions first. Do not use real student records until every item passes:

- [ ] Student with correct register number/password can sign in; incorrect password is rejected.
- [ ] A student cannot open faculty APIs or see another student's attempt.
- [ ] A faculty user can sign in; a student cannot sign in to the faculty portal.
- [ ] Faculty can create a test with four options per question and a valid scheduled time.
- [ ] Student cannot start before the scheduled start or after the test closes.
- [ ] A student can start once, save answers, refresh, and see their saved answers.
- [ ] Student payloads do not contain `correctIndex` before submission.
- [ ] Correct, wrong and unanswered counts, marks, negative marks, total possible score, accuracy and topic breakdown match a hand-calculated sample.
- [ ] Duplicate submissions do not create a second attempt or change the saved result.
- [ ] Faculty results show the correct student, score and attempt counts.
- [ ] Student creation, password reset and deletion work; credentials are shown only to the authorized faculty session.
- [ ] Firebase indexes are built and Vercel logs contain no missing-secret, permission or index errors.

## 11. Important limitations and operational notes

- The faculty password-change UI uses Firebase re-authentication and then updates the password; if Firebase requires a fresh sign-in, sign in again and retry.
- The faculty account must be provisioned manually the first time. Do not expose a public faculty-registration endpoint.
- Keep a secure process for distributing initial/reset student passwords. Avoid sending bulk credential exports through public channels, and require students to change temporary passwords through a future password-reset workflow before using sensitive accounts.
- The app should be treated as not production-ready until the checklist passes in your actual Firebase and Vercel Preview deployment. Local syntax checks cannot verify project permissions, database indexes, environment variables, hosting rewrites or real authentication behavior.

## 12. Exact Mac Terminal workflow (first Preview deployment)

Run these commands from the extracted `rani-firebase-integration` folder. Do not run them from the parent Downloads folder.

1. Check Node.js and npm are installed:

   ```bash
   node -v
   npm -v
   ```

2. Install the project dependencies:

   ```bash
   npm install
   ```

3. For the one-time student migration, save the downloaded Firebase service-account JSON in this folder as `service-account-ranipharma.json`. This file is ignored by Git. Keep it private. Then run:

   ```bash
   export FIREBASE_SERVICE_ACCOUNT_JSON="$(cat service-account-ranipharma.json)"
   node scripts/import-students.mjs /absolute/path/to/student-records.csv
   unset FIREBASE_SERVICE_ACCOUNT_JSON
   ```

   Confirm the printed report has an empty `failed` array. If it reports failures, stop and resolve them before deploying or giving credentials to students. The importer only initializes passwords for newly created Firebase Auth accounts; it does not reset existing accounts' passwords.

4. Deploy Firestore rules and indexes (requires Firebase CLI access to project `ranipharma`):

   ```bash
   npx firebase-tools@latest login
   npx firebase-tools@latest deploy --project ranipharma --only firestore:rules,firestore:indexes
   ```

5. Create a **new Vercel Preview project** for this integration so the current live project is not replaced. From the project folder, run:

   ```bash
   npx vercel
   ```

   Follow the prompts to sign in and create/link a new project. Do not select the existing production project if you are unsure which one is live. Keep the project root at this folder, where `package.json`, `vercel.json`, `firebase-client.js`, and `api/` are located.

6. In that new Vercel project, open **Settings → Environment Variables**. Add `FIREBASE_SERVICE_ACCOUNT_JSON` with the complete service-account JSON for project `ranipharma`. Select **Preview** first. Never use the Firebase web config as this variable; it must be the private service-account JSON. Redeploy the Preview after adding it.

7. Open the Preview URL and check that `/`, `/faculty`, `/waiting`, and `/test` load. Then sign in with test accounts and run every item in Section 10. The faculty page now shows an API-connection error rather than silently displaying sample data if the deployed backend is missing.

8. Only after all tests pass should you configure the Production environment variable and deploy to Production. Do not change the current custom domain or delete the old Vercel project until you have a verified rollback/backup plan.

## 13. Database consistency and account safety

- The SQL file is a one-time import source, not a live SQL Server connection. After migration, Firebase Authentication stores the login password securely and Firestore stores profile/test/result data.
- The API now requires a user profile to have `active: true` before protected routes work. The initial faculty profile and every imported student profile must include this field.
- A successful JavaScript syntax check is not proof of a successful database connection. Confirm the import report, deployed `/api/auth/me` response while signed in, Firestore documents, and the full end-to-end checklist before real use.
- Never publish a student records file, import report containing identifiers, or a service-account JSON file. The source file contains plaintext initial passwords. Distribute them privately and require a password-change process before using sensitive accounts.
