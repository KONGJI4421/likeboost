// Service worker ของ LikeBoost — รับ push แล้วโผล่เป็นแจ้งเตือนบนมือถือ
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { title: 'LikeBoost', body: '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'LikeBoost', {
      body: data.body || '',
      icon: data.icon || '/admin-icon-192.png',
      badge: '/admin-icon-192.png',
      tag: data.tag || 'likeboost-notify',
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url: data.url || '/admin' },
    })
  );
});

// แตะแจ้งเตือน → เปิด/โฟกัสแอปแอดมิน
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/admin';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
