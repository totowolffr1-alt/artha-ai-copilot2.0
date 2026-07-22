import webpush from 'web-push';
import { pushSubscriptions } from '../db/sqlite';

if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  const vapidKeys = webpush.generateVAPIDKeys();
  console.warn('VAPID keys not found in .env. Generated new ones:');
  console.warn(`VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
  console.warn(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
  process.env.VAPID_PUBLIC_KEY = vapidKeys.publicKey;
  process.env.VAPID_PRIVATE_KEY = vapidKeys.privateKey;
}

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL || 'admin@artha-ai.com'}`,
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export function getVapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY!;
}

export function addSubscription(endpoint: string, p256dh: string, auth: string) {
  pushSubscriptions.upsert(endpoint, p256dh, auth);
}

export function removeSubscription(endpoint: string) {
  pushSubscriptions.remove(endpoint);
}

export async function sendPushToAll(title: string, body: string, severity: string, url?: string): Promise<number> {
  const subs = pushSubscriptions.getAll();
  let successCount = 0;
  
  const payload = JSON.stringify({
    title,
    body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: { url: url || '/', severity }
  });

  for (const sub of subs) {
    try {
      const subscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth
        }
      };
      await webpush.sendNotification(subscription, payload);
      successCount++;
    } catch (err: any) {
      if (err.statusCode === 410) {
        removeSubscription(sub.endpoint);
      } else {
        console.error('Error sending push notification:', err);
      }
    }
  }
  return successCount;
}
