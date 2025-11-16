# Functions: cleanupExpiredPins

This folder contains a Firebase Cloud Function that removes expired pins
from the Realtime Database so they are deleted even if no clients are connected.

Setup & deploy

1. Install Firebase CLI (if needed):

```bash
npm install -g firebase-tools
```

2. Login and initialize (if you haven't already):

```bash
firebase login
firebase init functions
```

When asked, choose the existing project and use Node 18.

3. Install dependencies and deploy the function:

```bash
cd functions
npm install
firebase deploy --only functions:cleanupExpiredPins
```

Notes
- Scheduled functions require Cloud Scheduler which may need a Blaze (billing) project.
- The function scans each group's `pins` child and deletes pins where `expiresAt <= now`.
