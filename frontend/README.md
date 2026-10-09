# NeuroLock app (Expo)

```bash
npm install
npm start        # w = web, a = Android emulator, i = iOS simulator, or scan the QR with Expo Go
npm run typecheck
```

The API must be running (see the root `README.md`). The app calls port 4311 on the machine
that runs Expo, which works for web, emulators and phones on the same Wi-Fi. To use a
different server, set `EXPO_PUBLIC_API_URL` in `.env` (see `.env.example`) and restart Expo.

## How screens decide what to show
After sign-in the app loads the user's permissions from `GET /api/auth/me` and refreshes them
every minute, when the app returns to the foreground, and after any 403. Dashboard tabs,
action buttons and patient-profile sections are rendered from those permissions
(`components/dashboard/RoleDashboard.tsx`, `constants/permissions.ts`). The server enforces
the same rules, so hiding a button is only a convenience.

## Structure
* `App.tsx`: one navigator per auth state (signed out / MFA step / biometric lock / signed in)
* `context/AuthContext.tsx`: session, permissions, MFA challenge, biometric unlock, auto sign-out
* `context/StepUpContext.tsx`: re-authentication prompt for sensitive actions
* `services/api.ts`: typed API client; `services/storage.ts`: SecureStore on mobile, localStorage on web
* `components/dashboard/*`: feature modules (patients, notes, medications, …, staff, roles, audit, security)
* `components/common/*`: layout, forms, dialogs and formatting helpers
* `components/ui/*.native.tsx`: base UI kit
