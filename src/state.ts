//                                                                                             [BYTE_ID]
// #region ══════════════════════════════════════════════════════════════════════════════════════════════════════
export class BYTE_ID {
  /*  ==========================================================================================================================
       provides lightweight numeric and string ID generation, using a Uint32Array counter for incrementing byte-level IDs and 
       a separate counter for string IDs. It also preallocates fixed-size timestamp and resolver arrays to 
       track up to 4,096 pending operations.
  
       The update byteid function now shares the counter with sid, the string variant. At the smae time, a rollover counter that 
       increments whenever the 32-bit counter wraps. Keeping the fact U32Array counter while producing ids that remain unique.
      ================================================================================ ⇦✦──⇦✦──✦──✦──← 'pew pew' 🧙 [BYTE_ID] */
      public MAX_PENDING = 4096;
      public sentTimestamps;
      public pendingResolvers;
      public cursor = 0;
      private readonly counter: U32;
      private epoch = 0;
      public id(): string {
          const g = globalThis as A;
          const c = g._sauronIdCounter ?? (g._sauronIdCounter = new Uint32Array(1));
          if (++c[0] === 0) this.epoch++;
          g._sauronIdCounter = c;
          return `${this.epoch}:${c[0]}`;
      }
      public _sid(): string {
          return  this.id()
      }
      constructor() {
          this.counter = new Uint32Array(1);
          this.sentTimestamps = new Float64Array(this.MAX_PENDING);
          this.pendingResolvers = new Array(this.MAX_PENDING);
      }
  }
  
export const _bid = new BYTE_ID()

// #endregion
//                                                                                               [STORE]
// #region ══════════════════════════════════════════════════════════════════════════════════════════════════════
export const ROOT_REG = '__ROOT_REG__'
export const MASTER_REG = '__MASTER_REG__'
export const SLAVE_REG = '__SLAVE_REG__'

interface ScopeOptions {
  sl_reg?: any
  ms_reg?: any
  globalKey?: any
}

export function getNestedStoreMap<K, V>(  sl_reg: any = SLAVE_REG,  ms_reg: any = MASTER_REG,  globalKey: any = ROOT_REG,): Map<K, V> {
  let root = (globalThis as any)[globalKey]
  if (!root) {
    root = new Map<any, Map<any, Map<any, any>>>();
    ; (globalThis as any)[globalKey] = root;
  }

  let masterMap = root.get(ms_reg)
  if (!masterMap) { masterMap = new Map<any, Map<any, any>>(); root.set(ms_reg, masterMap); }
  let slaveMap = masterMap.get(sl_reg)
  if (!slaveMap) { slaveMap = new Map<K, V>(); masterMap.set(sl_reg, slaveMap); }
  return slaveMap
}

export const store = {
  get<T>(key: any, opts: ScopeOptions = {}): T | undefined {
    const { sl_reg, ms_reg, globalKey } = opts
    const _state = getNestedStoreMap<any, any>(sl_reg, ms_reg, globalKey)
    const _persistent = getNestedStoreMap<any, any>(sl_reg ? `${sl_reg}_PERSISTENT` : undefined, ms_reg, globalKey)
    const _persistKeys = getNestedStoreMap<any, boolean>(sl_reg ? `${sl_reg}_PERSIST_KEYS` : undefined, ms_reg, globalKey)
 
    if (_state.has(key)) return _state.get(key)
    if (_persistKeys.has(key) && _persistent.has(key)) {
      const v = _persistent.get(key)
      _state.set(key, v)
      return v
    }
    return undefined
  },
  set<T>(key: any, value: T | ((prev: T | undefined) => T), opts: { triggerRender?: boolean } & ScopeOptions = { triggerRender: true }): void {
    const { triggerRender = true, sl_reg, ms_reg, globalKey } = opts
    const _state = getNestedStoreMap<any, any>(sl_reg, ms_reg, globalKey)
    const _persistent = getNestedStoreMap<any, any>(sl_reg ? `${sl_reg}_PERSISTENT` : undefined, ms_reg, globalKey)
    const _persistKeys = getNestedStoreMap<any, boolean>(sl_reg ? `${sl_reg}_PERSIST_KEYS` : undefined, ms_reg, globalKey)
    const _listeners = getNestedStoreMap<any, Set<(value: any) => void>>(sl_reg ? `${sl_reg}_LISTENERS` : undefined, ms_reg, globalKey)

    const prev = _state.get(key)
    const next = typeof value === 'function' ? (value as (prev: T | undefined) => T)(prev) : value
    if (Object.is(prev, next)) return
    _state.set(key, next)
    if (_persistKeys.has(key)) _persistent.set(key, next)
    if (triggerRender) _listeners.get(key)?.forEach(l => l(next))
  },
  subscribe<T>(key: any, listener: (value: T) => void, opts: ScopeOptions = {}): () => void {
    const { sl_reg, ms_reg, globalKey } = opts
    const _listeners = getNestedStoreMap<any, Set<(value: any) => void>>(sl_reg ? `${sl_reg}_LISTENERS` : undefined, ms_reg, globalKey)

    if (!_listeners.has(key)) _listeners.set(key, new Set())
    _listeners.get(key)!.add(listener)
    return () => {
      _listeners.get(key)?.delete(listener)
      if (_listeners.get(key)?.size === 0) _listeners.delete(key)
    }
  },
  delete(key: any, opts: ScopeOptions = {}): boolean {
    const { sl_reg, ms_reg, globalKey } = opts
    const _state = getNestedStoreMap<any, any>(sl_reg, ms_reg, globalKey)
    const _persistent = getNestedStoreMap<any, any>(sl_reg ? `${sl_reg}_PERSISTENT` : undefined, ms_reg, globalKey)
    const _persistKeys = getNestedStoreMap<any, boolean>(sl_reg ? `${sl_reg}_PERSIST_KEYS` : undefined, ms_reg, globalKey)
    const _listeners = getNestedStoreMap<any, Set<(value: any) => void>>(sl_reg ? `${sl_reg}_LISTENERS` : undefined, ms_reg, globalKey)

    const existed = _state.delete(key)
    if (_persistKeys.has(key)) {
      _persistKeys.delete(key)
      _persistent.delete(key)
    }
    _listeners.get(key)?.forEach(l => l(undefined))
    _listeners.delete(key)
    return existed
  },
  entries<T = any>(opts: ScopeOptions = {}): [any, T][] {
    const { sl_reg, ms_reg, globalKey } = opts
    const _state = getNestedStoreMap<any, any>(sl_reg, ms_reg, globalKey)
    return Array.from(_state.entries())
  },
  persist(key: any, opts: ScopeOptions = {}): void {
    const { sl_reg, ms_reg, globalKey } = opts
    const _persistKeys = getNestedStoreMap<any, boolean>(   // Map, not Set
        sl_reg ? `${sl_reg}_PERSIST_KEYS` : undefined,
        ms_reg,
        globalKey
    )
    _persistKeys.set(key, true)
},
  unpersist(key: any, opts: ScopeOptions = {}): void {
    const { sl_reg, ms_reg, globalKey } = opts
    const _persistent = getNestedStoreMap<any, any>(sl_reg ? `${sl_reg}_PERSISTENT` : undefined, ms_reg, globalKey)
    const _persistKeys = getNestedStoreMap<any, boolean>(sl_reg ? `${sl_reg}_PERSIST_KEYS` : undefined, ms_reg, globalKey)
    _persistKeys.delete(key)
    _persistent.delete(key)
  },
  has(key: any, opts: ScopeOptions = {}): boolean {
    const { sl_reg, ms_reg, globalKey } = opts
    const _state = getNestedStoreMap<any, any>(sl_reg, ms_reg, globalKey)
    const _persistent = getNestedStoreMap<any, any>(sl_reg ? `${sl_reg}_PERSISTENT` : undefined, ms_reg, globalKey)
    const _persistKeys = getNestedStoreMap<any, boolean>(sl_reg ? `${sl_reg}_PERSIST_KEYS` : undefined, ms_reg, globalKey)

    return _state.has(key) || (_persistKeys.has(key) && _persistent.has(key))
  },
  clear(opts: ScopeOptions = {}): void {
    const { sl_reg, ms_reg, globalKey } = opts
    const _state = getNestedStoreMap<any, any>(sl_reg, ms_reg, globalKey)
    const _listeners = getNestedStoreMap<any, Set<(value: any) => void>>(sl_reg ? `${sl_reg}_LISTENERS` : undefined, ms_reg, globalKey)
    _state.clear()
    _listeners.clear()
  },
  clearPersistent(opts: ScopeOptions = {}): void {
    const { sl_reg, ms_reg, globalKey } = opts
    const _persistent = getNestedStoreMap<any, any>(sl_reg ? `${sl_reg}_PERSISTENT` : undefined, ms_reg, globalKey)
    const _persistKeys = getNestedStoreMap<any, boolean>(sl_reg ? `${sl_reg}_PERSIST_KEYS` : undefined, ms_reg, globalKey)
    _persistent.clear()
    _persistKeys.clear()
  }
}
// #endregion
//                                                                                               [STATE]
// #region ══════════════════════════════════════════════════════════════════════════════════════════════════════

export interface SauronState {
  get<T>(key: string | symbol, opts?: ScopeOptions): T | undefined
  set<T>(key: string | symbol, value: T | ((prev: T | undefined) => T), opts?: { triggerRender?: boolean } & ScopeOptions): void
  delete(key: string | symbol, opts?: ScopeOptions): boolean
  getByPrefix<T>(prefix: string, opts?: ScopeOptions): { key: string; value: T }[]
  getAll<T = any>(opts?: ScopeOptions): Record<string | symbol, T>
  subscribe<T>(key: string | symbol, listener: (value: T) => void, opts?: ScopeOptions): () => void
  subscribeAll(listener: (key: string | symbol, value: any) => void, opts?: ScopeOptions): () => void
  batch(key: string | symbol, fn: () => void, opts?: ScopeOptions): void
  clear(opts?: ScopeOptions): void
}

export function getScopedStateMetadata(  sl_reg: any = SLAVE_REG,  ms_reg: any = MASTER_REG,  globalKey: any = ROOT_REG) {
  let root = (globalThis as any)[globalKey]
  if (!root) {
    root = new Map<any, Map<any, Map<any, any>>>()
      ; (globalThis as any)[globalKey] = root
  }

  let masterMap = root.get(ms_reg)
  if (!masterMap) { masterMap = new Map<any, Map<any, any>>(); root.set(ms_reg, masterMap); }

  let metaMap = masterMap.get(`${sl_reg}_META`)
  if (!metaMap) {
    metaMap = {
      _batches: new Set<string | symbol>(),
      _batchQueue: new Map<string | symbol, any>(),
      _batchOpts: new Map<string | symbol, { triggerRender?: boolean }>(),
      _globalListeners: new Set<(key: string | symbol, value: any) => void>()
    }
    masterMap.set(`${sl_reg}_META`, metaMap)
  }
  return metaMap
}

export const state: SauronState = {
  get<T>(key: string | symbol, opts: ScopeOptions = {}): T | undefined { return store.get<T>(key, opts) },
  set<T>(key: string | symbol, value: T | ((prev: T | undefined) => T), opts: { triggerRender?: boolean } & ScopeOptions = {}): void {
    const { sl_reg, ms_reg, globalKey, triggerRender = true } = opts
    const meta = getScopedStateMetadata(sl_reg, ms_reg, globalKey)

    if (meta._batches.has(key)) {
      const prev = store.get<T>(key, opts)
      const next = typeof value === 'function' ? (value as (prev: T | undefined) => T)(prev) : value
      meta._batchQueue.set(key, next)
      meta._batchOpts.set(key, { triggerRender })
      return
    }
    store.set(key, value, { triggerRender, sl_reg, ms_reg, globalKey })

    // Broadcast to scoped global subscribers
    const finalVal = store.get(key, opts)
    for (const listener of meta._globalListeners) {
      try {
        listener(key, finalVal)
      } catch (err) {
        console.error(`[Sauron Global Listener Error]:`, err)
      }
    }
  },
  delete(key: string | symbol, opts: ScopeOptions = {}): boolean {
    const { sl_reg, ms_reg, globalKey } = opts
    const meta = getScopedStateMetadata(sl_reg, ms_reg, globalKey)

    meta._batchQueue.delete(key)
    meta._batchOpts.delete(key)
    const deleted = store.delete(key, opts)

    if (deleted) {
      for (const listener of meta._globalListeners) {
        try {
          listener(key, undefined)
        } catch (err) {
          console.error(`[Sauron Global Listener Error]:`, err)
        }
      }
    }
    return deleted
  },
  getByPrefix<T>(prefix: string, opts: ScopeOptions = {}): { key: string; value: T }[] {
    return store.entries<T>(opts)
      .filter(([key]) => typeof key === 'string' && key.startsWith(prefix))
      .map(([key, value]) => ({ key: key as string, value }))
  },
  getAll<T = any>(opts: ScopeOptions = {}): Record<string | symbol, T> {
    const result: Record<string | symbol, T> = {}
    for (const [key, value] of store.entries<T>(opts)) {
      result[key] = value
    }
    return result
  },
  subscribe<T>(key: string | symbol, listener: (value: T) => void, opts: ScopeOptions = {}): () => void {
    return store.subscribe<T>(key, listener, opts)
  },
  subscribeAll(listener: (key: string | symbol, value: any) => void, opts: ScopeOptions = {}): () => void {
    const { sl_reg, ms_reg, globalKey } = opts
    const meta = getScopedStateMetadata(sl_reg, ms_reg, globalKey)
    meta._globalListeners.add(listener)
    return () => {
      meta._globalListeners.delete(listener)
    }
  },
  batch(key: string | symbol, fn: () => void, opts: ScopeOptions = {}): void {
    const { sl_reg, ms_reg, globalKey } = opts
    const meta = getScopedStateMetadata(sl_reg, ms_reg, globalKey)

    meta._batches.add(key)
    try {
      fn()
      if (meta._batchQueue.has(key)) {
        const value = meta._batchQueue.get(key)
        const batchOpts = meta._batchOpts.get(key) ?? {}
        meta._batchQueue.delete(key)
        meta._batchOpts.delete(key)
        store.set(key, value, { ...batchOpts, sl_reg, ms_reg, globalKey })
      }
    } finally {
      meta._batches.delete(key)
    }
  },
  clear(opts: ScopeOptions = {}): void {
    const { sl_reg, ms_reg, globalKey } = opts
    const meta = getScopedStateMetadata(sl_reg, ms_reg, globalKey)
    store.clear(opts)
    meta._batches.clear()
    meta._batchQueue.clear()
    meta._batchOpts.clear()
    meta._globalListeners.clear()
  }
}
export default state

export function publish(key: string | symbol, value: any, opts?: ScopeOptions): void { state.set(key, value, opts) }
export function subscribe<T = any>(key: string | symbol, listener: (value: T) => void, opts?: ScopeOptions): () => void { return state.subscribe<T>(key, listener, opts) }
export function getAll<T = any>(opts?: ScopeOptions): Record<string | symbol, T> { return state.getAll<T>(opts) }

export function set<T>(label: string, value: T, triggerRender = true, sl_reg?: any, ms_reg?: any, globalKey?: any): void {
  if (!label) return
  state.set(label, value, { triggerRender, sl_reg, ms_reg, globalKey })
}
export function get<T>(label: string, sl_reg?: any, ms_reg?: any, globalKey?: any): T | undefined {
  if (!label) return undefined
  return state.get<T>(label, { sl_reg, ms_reg, globalKey })
}
export function sub<T>(label: string, fn: (value: T) => void, sl_reg?: any, ms_reg?: any, globalKey?: any): () => void {
  if (!label || !fn) return () => { }
  return state.subscribe<T>(label, fn, { sl_reg, ms_reg, globalKey })
}
export function del(label: string, sl_reg?: any, ms_reg?: any, globalKey?: any): boolean {
  if (!label) return false
  return state.delete(label, { sl_reg, ms_reg, globalKey })
}
export function subAll(fn: (key: string | symbol, value: any) => void, sl_reg?: any, ms_reg?: any, globalKey?: any): () => void {
  if (!fn) return () => { }
  return state.subscribeAll(fn, { sl_reg, ms_reg, globalKey })
}
// #endregion


