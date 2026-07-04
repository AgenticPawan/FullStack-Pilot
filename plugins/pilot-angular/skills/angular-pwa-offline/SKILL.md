---
name: angular-pwa-offline
description: Reviews Angular PWA/offline-first setup for apps that need to work in the field with intermittent connectivity. Flags @angular/service-worker not configured, no offline fallback page/shell, a caching strategy that doesn't distinguish app-shell assets from API data, and no conflict-resolution story for data edited offline and synced later. Only relevant for shops shipping field/offline-capable apps — most internal line-of-business apps can skip this. Outputs findings with pilot-angular pwa-offline standard IDs.
when_to_use: PWA, service worker, offline first, ngsw-config, App Shell, offline fallback, background sync, IndexedDB cache, connectivity detection, field app offline
applies_to: angular>=17
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| PWA-001 | P1 | `@angular/service-worker` not configured despite an offline requirement |
| PWA-002 | P2 | No offline fallback page/shell shown when the network is unreachable |
| PWA-003 | P2 | Caching strategy doesn't distinguish static app-shell assets from dynamic API data |
| PWA-004 | P1 | No conflict-resolution story for data edited offline and synced later |

---

## Check A — Service worker not configured (PWA-001)

### Detection

For an app with a stated offline requirement (field technicians, warehouse scanning apps),
check whether `@angular/service-worker` is added (`ng add @angular/pwa`) and registered in
`app.config.ts`. Without it, the app simply fails to load with no cached shell the moment
connectivity drops.

### BAD — no service worker despite an offline requirement

```typescript
export const appConfig: ApplicationConfig = {
  providers: [provideHttpClient(), provideRouter(routes)],
  // No provideServiceWorker() — the app is unusable the moment the network drops.
};
```

### GOOD — service worker registered, enabled only in production

```typescript
export const appConfig: ApplicationConfig = {
  providers: [
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
```

---

## Check B — No offline fallback UI (PWA-002)

### Detection

Check whether the app shows a dedicated "you're offline" state (via
`SwUpdate`/`navigator.onLine` + a connectivity service) versus letting failed HTTP calls
surface as generic errors indistinguishable from a server-side failure (overlaps
`angular-error-handling` AEH-004's recoverable-vs-crash distinction — offline is a third,
distinct state).

### BAD — offline looks identical to a generic server error

```typescript
this.http.get('/api/orders').pipe(
  catchError(() => { this.toast.show('Something went wrong'); return of([]); })
).subscribe();
```

### GOOD — a distinct offline state, informed by a connectivity service

```typescript
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  readonly online = toSignal(
    merge(fromEvent(window, 'online').pipe(map(() => true)),
          fromEvent(window, 'offline').pipe(map(() => false))),
    { initialValue: navigator.onLine });
}
```

```html
@if (!connectivity.online()) {
  <app-offline-banner />
}
```

---

## Check C — Caching strategy doesn't distinguish shell from API data (PWA-003)

### Detection

Check `ngsw-config.json` for whether static app-shell assets (JS/CSS bundles, fonts) use a
`prefetch`/`install` strategy while dynamic API responses use a separate `dataGroups`
entry with an appropriate freshness/performance strategy — treating everything as one
undifferentiated cache either serves stale API data indefinitely or never caches the shell
at all.

### BAD — one undifferentiated asset group

```json
{
  "assetGroups": [
    { "name": "app", "installMode": "prefetch", "resources": { "files": ["/**"] } }
  ]
  // No dataGroups — API responses are either never cached or accidentally caught by the wildcard.
}
```

### GOOD — separate strategies for shell assets vs. API data

```json
{
  "assetGroups": [
    { "name": "app", "installMode": "prefetch", "resources": { "files": ["/*.css", "/*.js", "/index.html"] } }
  ],
  "dataGroups": [
    {
      "name": "orders-api",
      "urls": ["/api/orders/**"],
      "cacheConfig": { "strategy": "freshness", "maxAge": "1h", "timeout": "5s" }
    }
  ]
}
```

---

## Check D — No conflict resolution for offline edits (PWA-004)

### Detection

For an app that lets a user edit data while offline (not just read cached data), check
whether a sync mechanism exists for reconciling those edits once connectivity returns —
and whether it accounts for the same optimistic-concurrency conflicts `dotnet-concurrency`
CCY-001/CCY-002 handles server-side (the offline edit's `RowVersion` may be stale by the
time it syncs).

### BAD — offline edits queued with no conflict handling on sync

```typescript
async syncPendingEdits() {
  for (const edit of this.offlineQueue.getAll()) {
    await this.http.put(`/api/orders/${edit.id}`, edit.payload).toPromise();
    // No handling for a 409 Conflict if the record changed server-side while offline.
  }
}
```

### GOOD — conflicts surfaced for user resolution instead of silently overwritten

```typescript
async syncPendingEdits() {
  for (const edit of this.offlineQueue.getAll()) {
    try {
      await this.http.put(`/api/orders/${edit.id}`, edit.payload,
        { headers: { 'If-Match': edit.rowVersion } }).toPromise(); // ties to dotnet-concurrency CCY-003
      this.offlineQueue.remove(edit.id);
    } catch (err) {
      if (err.status === 409) this.conflictResolver.queue(edit); // user resolves manually, not silent overwrite
    }
  }
}
```
