
<div align="left" style="position: relative;">
<img src="./icons/gandalf.png" align="right" width="30%" style="margin: -20px 0 0 20px;">

<h1>Databases: <span style="font-size:18px;" >The Wizard's Arsenal</span></h1>

<p align="left"><em>The most opinionated platform... ever.</em></p>
<p align="left"><em>Trust me... I'm a fucking wizard... 🧙</em></p>
<p align="left">VSCode ext:</p>
<p align="left">
<img src="https://img.shields.io/badge/THEMES- 251-95ED27?style=flat">
<img src="https://img.shields.io/badge/SIDEBARS- 160+-95ED27?style=flat">
<img src="https://img.shields.io/badge/PRODUCT ICONS- 651-95ED27?style=flat">
<img src="https://img.shields.io/badge/FILE ICONS- 454-95ED27?style=flat">
<img src="https://img.shields.io/badge/VSCode Extentions- 82+-95ED27?style=flat">
<img src="https://img.shields.io/badge/FEATURES- SHIT TONNE-95ED27?style=flat">
</p>
<p align="left">Small but powerful repos worth checking out:</p>
<p align="left">

<a href="https://github.com/the-w1zard/app_store"><img src="https://img.shields.io/badge/Store / Maelstrom-000000.svg?style=flat&logo=JetBrains&logoColor=white" alt="JetBrains"></a>
<a href="https://github.com/the-w1zard/dx"><img src="https://img.shields.io/badge/UX /DX-34A853.svg?style=flat&logo=Android&logoColor=white" alt="Android"></a>
<a href="https://github.com/the-w1zard/temporal_shift"><img src="https://img.shields.io/badge/Temporal Shift-77AA99.svg?style=flat&logo=Org&logoColor=white" alt="Org"></a>
<a href="https://github.com/the-w1zard/the_cloud"><img src="https://img.shields.io/badge/The Cloud-02303A.svg?style=flat&logo=Gradle&logoColor=white" alt="Gradle"></a>
<a href="https://github.com/the-w1zard/signals"><img src="https://img.shields.io/badge/Signals-02303A.svg?style=flat&logo=Gradle&logoColor=white" alt="Gradle"></a>
<img src="https://img.shields.io/badge/Sometimes, my genius... It generates gravity.-4285F4.svg?style=flat&logo=🧙&logoColor=white" alt="Google">
<a href="https://github.com/the-w1zard"><img src="https://img.shields.io/badge/Coming Soon: The Wizard Platform-7F52FF.svg?style=flat&logo=Kotlin&logoColor=white" alt="Kotlin"></a>
<a href="https://github.com/the-w1zard"><img src="https://img.shields.io/badge/Coming Soon: Hadron Particle Disruptor-%23ED8B00.svg?style=flat&logo=openjdk&logoColor=white" alt="java"></a>
</p>
<p align="left">The goal? To remove all friction, from everything.</p>

</div>
<br clear="right">

---
<span  style="font-family: monospace"> 


> [!NOTE] TLDR
>
> A collection of databases, all of which are small but powerful representations on each of the areas that they were made for. Essentially, turning the old, the boring and warn out browser data stores and breathing life back into them. 
>
> A must have whenever you have a need for one of them since their utlility is on point.

</span>


A browser-focused TypeScript module providing several storage adapters, reactive scoped state, isolated registries, and lightweight ID generation.

## Contents

- [Storage adapters](#storage-adapters)
- [Common adapter API](#common-adapter-api)
- [Choosing an adapter](#choosing-an-adapter)
- [Scoped state](#scoped-state)
- [Registries](#registries)
- [IDs](#ids)
- [Browser and runtime notes](#browser-and-runtime-notes)
- [Important implementation notes](#important-implementation-notes)

The module exports ready-to-use instances and their classes:

```ts
import {
  cache,
  cookie,
  gt,
  indexed_db,
  ls,
  session,
} from "./storage.js";
```

| Instance | Class | Backing store | Typical use |
|---|---|---|---|
| `cache` | `CACHE` | In-memory map | Temporary, fast browser-session data |
| `cookie` | `COOKIE` | Browser cookies | Small values that need to accompany requests |
| `gt` | `GT` | Properties on `globalThis` | Runtime-global values |
| `indexed_db` | `INDEXED_DB` | IndexedDB | Larger or structured persistent browser data |
| `ls` | `LS` | `localStorage` | Data that should persist across browser restarts |
| `session` | `SESSION` | `sessionStorage` | Data scoped to the current browser tab/session |

Most adapters expose `get`, `getMany`, `set`, `setMany`, `update`, `delete`, `deleteMany`, `has`, `subscribe`, `waitFor`, and `clear`. Exact behavior and available methods vary by adapter.

### Basic usage

```ts
await cache.set("theme", "dark");
const theme = cache.get("theme");

await ls.set("profile", { name: "Ada" });
const profile = ls.get("profile");

await session.set("wizard-step", 2);
const step = session.get("wizard-step");
```

Some methods are declared `async`, so awaiting writes is recommended, even when the underlying operation is synchronous.

### Observe changes

```ts
const unsubscribe = cache.subscribe<{ connected: boolean }>(
  "connection",
  (value) => {
    console.log("Connection state:", value);
  },
);

await cache.set("connection", { connected: true });

// Later:
unsubscribe();
```

When subscribing, the adapters generally call the callback immediately if a current value is available. Updates made through the adapter also notify subscribers.

Wait for a value to be set:

```ts
const token = await session.waitFor<string>("auth-token");
```

`SESSION.waitFor()` defaults to a 30-second timeout. The other adapters shown here do not set a timeout.

### Batch operations

```ts
await cache.setMany({
  theme: "dark",
  compactMode: true,
});

const values = await cache.getMany(["theme", "compactMode"]);
await cache.deleteMany(["theme", "compactMode"]);
```

`getMany()` returns an object keyed by the requested storage keys. Specific behavior for missing keys differs between adapters.

## Common adapter API

| Need | API | Example |
|---|---|---|
| Read a value | `get(key)` | `cache.get("theme")` |
| Read several values | `getMany(keys)` | `await ls.getMany(["theme", "profile"])` |
| Write a value | `set(key, value)` | `await session.set("step", 2)` |
| Write several values | `setMany(entries)` | `await cache.setMany({ a: 1, b: 2 })` |
| Replace an existing value only | `update(key, value)` | `await indexed_db.update("profile", profile)` |
| Check whether a key exists | `has(key)` | `await indexed_db.has("profile")` |
| Remove a value | `delete(key)` | `await cookie.delete("session-id")` |
| Remove several values | `deleteMany(keys)` | `await ls.deleteMany(["a", "b"])` |
| Watch changes | `subscribe(key, callback)` | `cache.subscribe("theme", onTheme)` |
| Wait for the next available value | `waitFor(key)` | `await session.waitFor("token")` |
| Clear adapter data | `clear()` | `await indexed_db.clear()` |

## Choosing an adapter

- Use **`cache`** for temporary data that only needs to live in the current page’s memory.
- Use **`session`** for tab-scoped data that should survive reloads within the session.
- Use **`ls`** for small browser data that should persist across restarts.
- Use **`cookie`** when cookie-specific options or request behavior are required.
- Use **`indexed_db`** for larger or more structured persistent browser data.
- Use **`gt`** for values shared through the current JavaScript global object—not as durable storage.

## Adapter-specific details

### `cache`

`CACHE` stores serialized values in an in-memory map. It does not persist across page reloads.

```ts
await cache.set("draft", { text: "Unsaved" });
const draft = cache.get("draft");
```

`CACHE.ser()` and `CACHE.deser()` support `Map` and `Set` serialization. The adapter does not expose a public TTL configuration method in the provided implementation; `ttl_active` is initially `false`.

### `cookie`

Cookie values are serialized and written through `document.cookie`. `set()` accepts cookie options:

```ts
await cookie.set("preferences", { color: "blue" }, {
  maxAge: 60 * 60 * 24 * 7,
  path: "/",
  sameSite: "lax",
  secure: true,
});
```

Supported options in the implementation are `maxAge`, `path`, `domain`, `secure`, `httpOnly`, and `sameSite`.

**Browser limitation:** JavaScript cannot create an `HttpOnly` cookie through `document.cookie`. Although `httpOnly` is accepted in the options type, setting it this way does not make a cookie HttpOnly. Set HttpOnly cookies from a server response instead.

### `gt`

`GT` reads and writes properties on `globalThis`:

```ts
await gt.set("appConfig", { debug: true });
const config = gt.get("appConfig");
```

These values are runtime globals, not durable storage. Use unique labels to avoid collisions with other code.

### `indexed_db`

`INDEXED_DB` uses an object store in IndexedDB. Its constructor accepts object-store and database names:

```ts
const db = new INDEXED_DB(
  "_DB_STORE_NAME_LAYER_", // object store name
  "_DB_NAME_LAYER_",       // database name
);

await db.set("profile", { name: "Ada" });
const profile = await db.get("profile");

console.log(await db.keys());
console.log(await db.count());

db.close();
```

The default export instance is named `indexed_db`. Additional helpers include:

- `getAllItems()`, `getAllKeys()`, `getAllValues()`, `count()`
- `createIndex()` and `deleteIndex()`
- `getByIndex()`, `getAllByIndex()`, `getKeysByIndex()`
- `iterateAll(callback)`
- `isOpen()` and `getDatabaseInfo()`

### `ls`

`LS` uses browser `localStorage`:

```ts
await ls.set("settings", { notifications: true });
const settings = ls.get("settings");
```

Data survives page reloads and browser restarts unless removed by the application or browser.

### `session`

`SESSION` uses browser `sessionStorage`:

```ts
await session.set("checkout-step", 2);
const step = session.get("checkout-step");

const value = await session.waitFor("later-value", 10_000);
```

`session.clear()` preserves the root registry key (`ROOT_REG`) while clearing other session storage entries.

## Scoped state

The module also exports a state API backed by nested maps on `globalThis`. State can be separated by root, master, and slave scope.

```ts
import { state } from "./state.js";

const scope = {
  globalKey: "__ROOT_REG__",
  ms_reg: "__MASTER_REG__",
  sl_reg: "preferences",
};

state.set("theme", "dark", scope);
const theme = state.get<string>("theme", scope);

const unsubscribe = state.subscribe("theme", (value) => {
  console.log("Theme changed:", value);
}, scope);

state.set("theme", "light", scope);
unsubscribe();
```

Scope fields are optional; the module defines defaults. Supply explicit identifiers when you need separate state areas.

### State methods

```ts
state.get(key, scope);
state.set(key, valueOrUpdater, { ...scope, triggerRender: true });
state.delete(key, scope);

state.getByPrefix("user:", scope);
state.getAll(scope);

state.subscribe(key, callback, scope);
state.subscribeAll((key, value) => {
  console.log(key, value);
}, scope);

state.batch("count", () => {
  state.set("count", 1, scope);
  state.set("count", 2, scope);
}, scope);

state.clear(scope);
```

`set()` accepts either a value or an updater function:

```ts
state.set("count", (previous = 0) => previous + 1, scope);
```

Use `triggerRender: false` to suppress key-level notifications from state writes.

### Persistence markers

`state.persist(key)` marks a key for persistence within the state store’s persistence maps. It is not the same as writing to `localStorage` or another durable browser store.

```ts
state.persist("theme", scope);
state.set("theme", "dark", scope);

state.unpersist("theme", scope);
state.clearPersistent(scope);
```

The store checks marked persistent values when reading a key whose regular state entry is missing.

### Convenience functions

The module also exports wrappers around the default state instance:

```ts
import {
  get,
  getAll,
  publish,
  set,
  sub,
  subAll,
  del,
} from "./state.js";

set("status", "ready");
const status = get<string>("status");
const unsubscribe = sub("status", console.log);

publish("status", "updated");
del("status");
unsubscribe();
```

For explicit scope control, use `state` methods or the SSC helpers such as `setSSC()`, `getSSC()`, and `subSSC()`.

## Registries

Registries provide isolated in-memory key/value state with per-key and global subscriptions.

```ts
import { createScopedReg, createRegistry } from "./registries.js";

const registry = createScopedReg("editor");

registry.set("document", { title: "Notes" });
registry.subscribe("document", (value) => console.log(value));
registry.subscribeAll((key, value) => console.log(key, value));

registry.delete("document");
registry.clear();
```

`createScopedReg()` creates a new isolated registry each time. `createRegistry()` reuses a registry with the same name from a global registry table:

```ts
const first = createRegistry("shared");
const second = createRegistry("shared");

console.log(first === second); // true
```

Registry methods include:

- `get()` and `set()`; `set()` supports updater functions
- `delete()`
- `getByPrefix()` and `getAll()`
- `subscribe()` and `subscribeAll()`
- `batch(key, callback)`
- `clear()` and `destroy()`

`destroy()` removes a named registry from the global registry table. `createScopedReg().destroy()` clears that scoped registry.

## IDs

`_bid` provides string IDs:

```ts
import { _bid } from "./byte-id.js";

const id = _bid.id();
```

IDs have the form `"epoch:counter"`. `_sid()` is an alias for `id()`. The class also exposes `MAX_PENDING`, `sentTimestamps`, `pendingResolvers`, and `cursor` for pending-operation bookkeeping.

## Browser and runtime notes

- The storage adapters are browser-oriented. Most operations return early when `window` is unavailable.
- `BroadcastChannel` is used when available to communicate changes between contexts. It is not a replacement for a durable storage layer.
- Some adapters use the Web Locks API when available to serialize writes.
- In non-browser runtimes, some methods return `null`, `undefined`, empty objects, or unresolved promises rather than performing storage operations.
- `indexed_db` requires IndexedDB. Browser privacy settings or storage restrictions may cause operations to fail.

## Important implementation notes

Review these behaviors in the supplied code before relying on the module in production:

1. **TTL is disabled by default.** The adapters initialize `ttl_active` to `false`. If enabled internally, the timer callbacks clear underlying data as well as memory in some adapters:
   - `LS.touchMemory()` calls `localStorage.clear()`.
   - `SESSION.touchMemory()` calls `sessionStorage.clear()`.
   - `COOKIE.touchMemory()` clears its in-memory cache, not browser cookies.

   This is destructive behavior, not just cache eviction.

2. **`CACHE` uses a separate notification/waiter map.** Its `clear()` method clears both maps, but other adapters may keep waiters in their in-memory cache. Treat `clear()` as destructive and check each adapter’s implementation.

3. **`GT` has multiple internal maps.** Its `clear()` method removes keys listed in `_GT_MEMORY` from `globalThis`; use it carefully, especially if global names may be shared.

4. **`LS.update()` uses `localStorage.update()`.** The standard Web Storage API does not define this method. As written, this call will fail in standard browsers; consider changing it to `localStorage.setItem()`.

5. **`LS` cross-context messages update storage but do not emit subscribers.** The `ls` BroadcastChannel handler does not call `_emit()` in the provided code, unlike several other adapters.

6. **The BroadcastChannel self-message flag is shared per instance.** Some adapters use `_localChange` to suppress handling a message. Test cross-tab behavior carefully, particularly when several adapter instances share the same channel name.

7. **`INDEXED_DB.createIndex()` and `deleteIndex()` open database version 2.** The normal `open()` path requests version 1. IndexedDB version upgrades should be coordinated with a consistent schema/version strategy.

8. **`INDEXED_DB` methods require browser support.** `keys()` and other database helpers do not all perform the same server-side guard as `get()` and `set()`.

9. **Subscriptions are local to an adapter instance.** Cross-context notifications only work where the corresponding BroadcastChannel handler updates or emits the relevant state.

10. **Serialization is JSON-based.** The custom serializer handles `Map` and `Set`, but does not preserve every JavaScript type. For example, functions, symbols, `BigInt`, cyclic objects, dates, and class instances need explicit handling before storage.

11. **`waitFor()` generally has no cancellation API.** `SESSION.waitFor()` supports a timeout, but the other implementations can remain pending indefinitely if no value is set.

---

*This README documents the supplied implementation. Verify the module’s export paths, TypeScript types, and runtime behavior against the final source before publishing.*
