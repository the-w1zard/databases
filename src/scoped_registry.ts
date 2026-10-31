//                                                                                   [SCOPED REGISTRIES]
// #region ══════════════════════════════════════════════════════════════════════════════════════════════════════

import { _bid, type SauronState } from "./state.js"

export interface SauronRegistry extends SauronState {
  /** Diagnostic name for this scoped registry. */
  readonly name: string

  /** Read a value by key. */
  get<T = unknown>(key: string | symbol): T | undefined

  /** Write a value (or updater function) by key. */
  set<T>(
    key: string | symbol,
    value: T | ((prev: T | undefined) => T),
    opts?: { triggerRender?: boolean }
  ): void

  /** Remove a key. Returns `true` if the key existed. */
  delete(key: string | symbol): boolean

  /** All entries whose string key starts with `prefix`. */
  getByPrefix<T = unknown>(prefix: string): { key: string; value: T }[]

  /** Snapshot of every entry. */
  getAll<T = unknown>(): Record<string | symbol, T>

  /** Subscribe to changes for a single key. Returns an unsubscribe fn. */
  subscribe<T = unknown>(
    key: string | symbol,
    listener: (value: T) => void
  ): () => void

  /** Subscribe to every key change. Returns an unsubscribe fn. */
  subscribeAll(
    listener: (key: string | symbol, value: unknown) => void
  ): () => void

  /** Coalesce multiple `set` calls on `key` into a single notification. */
  batch(key: string | symbol, fn: () => void): void

  /** Wipe all state and listeners. */
  clear(): void

  /** Tear down the registry (currently equivalent to `clear`). */
  destroy(): void
}

export function createScopedReg(name: string = _bid.id()): SauronRegistry {
  // Completely isolated store + infra
  const _state = new Map<any, any>()
  const _listeners = new Map<any, Set<(value: any) => void>>()
  const _batches = new Set<string | symbol>()
  const _batchQueue = new Map<string | symbol, any>()
  const _batchOpts = new Map<string | symbol, { triggerRender?: boolean }>()
  const _globalListeners = new Set<(key: string | symbol, value: any) => void>()

  const registry: SauronRegistry = {
    name,
    get<T>(key: string | symbol): T | undefined { return _state.get(key) },
    set<T>(key: string | symbol, value: T | ((prev: T | undefined) => T), opts: { triggerRender?: boolean } = {}): void {
      if (_batches.has(key)) {
        const prev = _state.get(key)
        const next = typeof value === 'function' ? (value as any)(prev) : value
        _batchQueue.set(key, next)
        _batchOpts.set(key, opts)
        return
      }

      const prev = _state.get(key)
      const next = typeof value === 'function' ? (value as any)(prev) : value

      if (Object.is(prev, next)) return

      _state.set(key, next)

      // Notify key listeners
      const ls = _listeners.get(key)
      if (ls) {
        for (const fn of ls) {
          try { fn(next) } catch (err) {
            console.error(`[Registry ${name} Listener Error]:`, err)
          }
        }
      }

      // Notify global listeners
      for (const fn of _globalListeners) {
        try { fn(key, next) } catch (err) {
          console.error(`[Registry ${name} Global Listener Error]:`, err)
        }
      }
    },
    delete(key: string | symbol): boolean {
      _batchQueue.delete(key)
      _batchOpts.delete(key)

      const existed = _state.delete(key)

      if (existed) {
        for (const fn of _globalListeners) {
          try { fn(key, undefined) } catch (err) {
            console.error(`[Registry ${name} Global Listener Error]:`, err)
          }
        }
      }

      return existed
    },
    getByPrefix<T>(prefix: string): { key: string; value: T }[] {
      const out: { key: string; value: T }[] = []
      for (const [k, v] of _state.entries()) {
        if (typeof k === 'string' && k.startsWith(prefix)) {
          out.push({ key: k, value: v })
        }
      }
      return out
    },
    getAll<T = any>(): Record<string | symbol, T> {
      const out: Record<string | symbol, T> = {}
      for (const [k, v] of _state.entries()) out[k] = v
      return out
    },
    subscribe<T>(key: string | symbol, listener: (value: T) => void): () => void {
      if (!_listeners.has(key)) _listeners.set(key, new Set())
      _listeners.get(key)!.add(listener)
      return () => {
        const set = _listeners.get(key)
        if (!set) return
        set.delete(listener)
        if (set.size === 0) _listeners.delete(key)
      }
    },
    subscribeAll(listener: (key: string | symbol, value: any) => void): () => void {
      _globalListeners.add(listener)
      return () => _globalListeners.delete(listener)
    },
    batch(key: string | symbol, fn: () => void): void {
      _batches.add(key)
      try {
        fn()
        if (_batchQueue.has(key)) {
          const value = _batchQueue.get(key)
          const opts = _batchOpts.get(key) ?? {}
          _batchQueue.delete(key)
          _batchOpts.delete(key)
          registry.set(key, value, opts)
        }
      } finally {
        _batches.delete(key)
      }
    },
    clear(): void {
      _state.clear()
      _listeners.clear()
      _batches.clear()
      _batchQueue.clear()
      _batchOpts.clear()
      _globalListeners.clear()
    },
    destroy(): void { registry.clear() }
  }
  return registry
}

// #endregion
