// public/sw.js
// Service worker MÍNIMO: solo push (sin caché offline, fuera de alcance v1).
// Vite sirve public/ en la raíz → disponible en /sw.js con scope "/".

// Al recibir un push, mostramos la notificación. El payload lo manda el server
// como JSON {title, body, url}. Fallback defensivo si llega vacío/no-JSON.
self.addEventListener("push", (event) => {
  let data = { title: "El Coche del Día", body: "Ya puedes jugar al coche de hoy 🚗", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* payload no-JSON: usamos el fallback */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/web-app-manifest-192x192.png",
      badge: "/web-app-manifest-192x192.png",
      data: { url: data.url || "/" },
    })
  );
});

// Al pulsar la notificación: si ya hay una pestaña del juego, la enfocamos;
// si no, abrimos una nueva en la URL indicada.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) return w.focus();
      }
      return clients.openWindow(url);
    })
  );
});
