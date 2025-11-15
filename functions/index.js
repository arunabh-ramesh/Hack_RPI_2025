const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize the admin SDK. When deployed this will use the project's
// service account automatically.
try {
  admin.initializeApp();
} catch (e) {
  // ignore if already initialized in a long-running environment
}

/**
 * Scheduled Cloud Function that runs every minute and deletes expired pins.
 *
 * It queries each group's `pins` node for pins where `expiresAt <= now`
 * and removes them. Using a scheduled function guarantees cleanup even when
 * no clients are connected.
 */
exports.cleanupExpiredPins = functions.pubsub
  .schedule('every 1 minutes')
  .onRun(async (context) => {
    const now = Date.now();
    const rootRef = admin.database().ref('groups');
    const groupsSnap = await rootRef.once('value');
    if (!groupsSnap.exists()) {
      return { deleted: 0 };
    }

    const groups = groupsSnap.val();
    const deletes = [];

    // For each group, query pins that have expiresAt <= now and delete them.
    for (const groupId of Object.keys(groups)) {
      try {
        const pinsRef = admin.database().ref(`groups/${groupId}/pins`);
        const expiredSnap = await pinsRef.orderByChild('expiresAt').endAt(now).once('value');
        if (expiredSnap.exists()) {
          expiredSnap.forEach(child => {
            deletes.push(child.ref.remove());
          });
        }
      } catch (e) {
        // don't fail entire run for one group
        console.warn(`Error checking pins for group ${groupId}:`, e);
      }
    }

    await Promise.all(deletes);
    return { deleted: deletes.length };
  });
