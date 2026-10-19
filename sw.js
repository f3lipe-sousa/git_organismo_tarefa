"use strict";

const CACHE_PREFIX = "organismo-de-tarefas-shell-";
const CACHE_NAME = CACHE_PREFIX + "v9";

const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./style.css",
  "./core.js",
  "./app.js"
];

const OPTIONAL_ICONS = [
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async cache => {
        await cache.addAll(SHELL);

        await Promise.all(
          OPTIONAL_ICONS.map(path =>
            cache.add(path).catch(() => {})
          )
        );
      })
  );

  // A nova versão aguarda o fechamento das telas antigas,
  // evitando trocar os arquivos no meio de uma sessão.
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key =>
          (key.startsWith(CACHE_PREFIX) ||
            key === "organismo-de-tarefas-v6") &&
          key !== CACHE_NAME
        ).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);

  if (url.origin !== scope.origin ||
      !url.pathname.startsWith(scope.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () =>
        await caches.match(
          new URL("./index.html", scope).href
        ) || await caches.match(
          new URL("./", scope).href
        )
      )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request))
  );
});
