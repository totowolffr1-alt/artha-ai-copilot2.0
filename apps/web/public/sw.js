// Service Worker for Artha AI Push Notifications
// Located at: apps/web/public/sw.js

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Artha AI', body: event.data.text(), data: {} };
  }

  const { title, body, icon, badge, data } = payload;

  const severityIcons = {
    CRITICAL: '🔴',
    HIGH:     '🟠',
    WARNING:  '🟡',
    INFO:     '🟢',
  };

  const severity = data?.severity || 'INFO';
  const displayTitle = `${severityIcons[severity] || '🔵'} ${title}`;

  const options = {
    body,
    icon:  icon  || '/favicon.ico',
    badge: badge || '/favicon.ico',
    data:  data  || {},
    tag:   `artha-${severity}-${Date.now()}`,
    requireInteraction: severity === 'CRITICAL',
    actions: severity === 'CRITICAL'
      ? [{ action: 'view', title: 'View Dashboard' }]
      : [],
    vibrate: severity === 'CRITICAL' ? [200, 100, 200, 100, 200] : [200],
  };

  event.waitUntil(
    self.registration.showNotification(displayTitle, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';
  const fullUrl = new URL(url, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === fullUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(fullUrl);
      }
    })
  );
});
