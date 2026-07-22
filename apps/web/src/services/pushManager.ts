/**
 * pushManager.ts — Browser Push Notification Manager for Artha AI
 * Handles service worker registration, permission request, and subscription lifecycle.
 */

const API_BASE = '/api';

/** Register service worker and set up push notifications */
export async function initPushNotifications(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('[Push] Browser does not support push notifications.');
    return false;
  }

  try {
    // Register service worker
    const registration = await navigator.serviceWorker.register('/sw.js');
    console.log('[Push] Service worker registered.');

    // Get VAPID public key from backend
    const keyRes = await fetch(`${API_BASE}/system/push/vapid-key`);
    const { publicKey } = await keyRes.json();
    if (!publicKey) { console.warn('[Push] No VAPID key from server.'); return false; }

    // Check existing permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('[Push] Notification permission denied.');
      return false;
    }

    // Subscribe to push
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    // Send subscription to backend
    await fetch(`${API_BASE}/system/push/subscribe`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(subscription.toJSON()),
    });

    console.log('[Push] ✅ Push notifications activated.');
    localStorage.setItem('push_enabled', 'true');
    return true;
  } catch (err) {
    console.error('[Push] Failed to initialize push notifications:', err);
    return false;
  }
}

/** Unsubscribe from push notifications */
export async function disablePushNotifications(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch(`${API_BASE}/system/push/unsubscribe`, {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
    localStorage.removeItem('push_enabled');
    console.log('[Push] Push notifications disabled.');
  } catch (err) {
    console.error('[Push] Failed to unsubscribe:', err);
  }
}

/** Check if push is currently enabled */
export function isPushEnabled(): boolean {
  return localStorage.getItem('push_enabled') === 'true' &&
         Notification.permission === 'granted';
}

/** Convert VAPID key from base64url to Uint8Array */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}
