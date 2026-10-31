//                                                                                          [REGISTRIES]
// #region ══════════════════════════════════════════════════════════════════════════════════════════════════════

import { _bid, type SauronState, state } from "./state.js"


const REGISTRIES = (globalThis as any).__sauron_scoped_registries ?? ((globalThis as any).__sauron_scoped_registries = {})
export function createRegistry(name: string = _bid.id()): SauronState & { name: string; destroy(): void } {
  if (REGISTRIES[name]) return REGISTRIES[name]

  // Completely isolated store + infra
  const _state = new Map<any, any>()
  const _listeners = new Map<any, Set<(value: any) => void>>()
  const _globalListeners = new Set<(key: any, value: any) => void>()
  const _batches = new Set<any>()
  const _batchQueue = new Map<any, any>()
  const _batchOpts = new Map<any, { triggerRender?: boolean }>()

  const api: SauronState & { name: string; destroy(): void } = {
    name,

    get<T>(key: any): T | undefined {
      return _state.get(key)
    },

    set<T>(key: any, value: T | ((prev: T | undefined) => T), opts: { triggerRender?: boolean } = {}): void {
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

      // key listeners
      const ls = _listeners.get(key)
      if (ls) for (const fn of ls) fn(next)

      // global listeners
      for (const fn of _globalListeners) fn(key, next)
    },

    delete(key: any): boolean {
      _batchQueue.delete(key)
      _batchOpts.delete(key)

      const existed = _state.delete(key)
      if (!existed) return false

      for (const fn of _globalListeners) fn(key, undefined)
      return true
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

    getAll<T = any>(): Record<any, T> {
      const out: Record<any, T> = {}
      for (const [k, v] of _state.entries()) out[k] = v
      return out
    },

    subscribe<T>(key: any, listener: (value: T) => void): () => void {
      if (!_listeners.has(key)) _listeners.set(key, new Set())
      _listeners.get(key)!.add(listener)
      return () => _listeners.get(key)!.delete(listener)
    },

    subscribeAll(listener: (key: any, value: any) => void): () => void {
      _globalListeners.add(listener)
      return () => _globalListeners.delete(listener)
    },

    batch(key: any, fn: () => void): void {
      _batches.add(key)
      try {
        fn()
        if (_batchQueue.has(key)) {
          const value = _batchQueue.get(key)
          const opts = _batchOpts.get(key) ?? {}
          _batchQueue.delete(key)
          _batchOpts.delete(key)
          api.set(key, value, opts)
        }
      } finally {
        _batches.delete(key)
      }
    },

    clear(): void {
      _state.clear()
      _listeners.clear()
      _globalListeners.clear()
      _batches.clear()
      _batchQueue.clear()
      _batchOpts.clear()
    },

    destroy(): void {
      api.clear()
      delete REGISTRIES[name]
    }
  }

  REGISTRIES[name] = api
  return api
}
export function getRegistry(name: string) { return REGISTRIES[name] }
export function getAllRegistries() { return REGISTRIES }
export function getGR(label: string, registry: string) {
  if (!label) return undefined
  return state.get(label)
}

// #endregion
