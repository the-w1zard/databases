export const ROOT_REG = '__THE_WIZARD_REG__'
export const MASTER_REG = '__SAURON__'
export const SLAVE_REG = '__STATE__'
export class SESSION {
    private ttl_active = false
    private ttl_minutes = 30
    protected memoryTimer?: ReturnType<typeof setTimeout>

    protected touchMemory() {
        if (this.memoryTimer) clearTimeout(this.memoryTimer)
        this.memoryTimer = setTimeout(() => {
            this.memory.clear()
            sessionStorage.clear()
            this.memoryTimer = undefined
        }, this.ttl_minutes * 60 * 1000)
    }
    protected memory = new Map<string, unknown>()
    public _channel?: BroadcastChannel
    private _echoId = Math.random().toString(36).slice(2)
    private subscribers = new Map<string, Set<(value: any) => void>>()
    constructor() {
        if (typeof BroadcastChannel !== 'undefined') {
            this._channel = new BroadcastChannel('sauron_storage_sync')
            this._channel.onmessage = (e) => {
                if (e.data?.echoId === this._echoId) return
                const { key, value, storageType, fn } = e.data
                if (storageType !== 'ss') return
                if (fn === 'delete') {
                    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(key)
                    this.memory.delete(key)
                    this._emit(key, undefined)
                } else {
                    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, value)
                    this.memory.set(key, value)
                    this._emit(key, this.deser(value))
                }
            }
        }
    }
    public ser(value: unknown): string {
        if (value instanceof Map) { return JSON.stringify({ __type: 'Map', value: Array.from(value.entries()).map(([key, val]) => [this.ser(key), this.ser(val)]) }) }
        if (value instanceof Set) { return JSON.stringify({ __type: 'Set', value: Array.from(value.values()).map(value => this.ser(value)) }) }
        return typeof value === 'string' ? value : JSON.stringify(value)
    }
    public deser(raw: string | null): any {
        if (raw === null) return null
        try {
            const parsed = JSON.parse(raw)
            if (parsed?.__type === 'Map') { return new Map(parsed.value.map(([key, value]: [string, string]) => [this.deser(key), this.deser(value)])) }
            if (parsed?.__type === 'Set') { return new Set(parsed.value.map((value: string) => this.deser(value))) }
            return parsed
        } catch {
            return raw
        }
    }
    public _broadcast(key: string, value: string, storageType: string, fn: string, path?: string, domain?: string, options?: any) {
        this._channel?.postMessage({ echoId: this._echoId, key, value, storageType, fn, path, domain, options })
    }
    private async _withLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
        if (typeof navigator !== 'undefined' && navigator.locks) {
            return navigator.locks.request('ss_write_' + key, fn) as Promise<T>
        }
        return fn()
    }

    public get(key: string) {
        if (typeof window === 'undefined') return;
        if (this.ttl_active) this.touchMemory()
        if (this.memory.has(key)) { return this.deser(this.memory.get(key) as string) }
        const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null
        const v = this.deser(raw)
        if (raw !== null) this.memory.set(key, raw)
        return v
    }
    public async getMany(keys: string[]): Promise<Record<string, any>> {
        if (typeof window === 'undefined') return {}
        if (this.ttl_active) this.touchMemory()
        const result: Record<string, any> = {}
        for (const key of keys) { result[key] = await this.get(key) }
        return result
    }
    public async set(key: string, value: string | object) {
        if (typeof window === 'undefined') return {}
        if (this.ttl_active) this.touchMemory(); if (!key) return;

        const wk = `__waiters_${key}`
        const ws = this.memory.get(wk) as Set<(value: unknown) => void> | undefined
        if (ws) { for (const resolve of ws) resolve(value); this.memory.delete(wk); }
        const serialized = this.ser(value)
        await this._withLock(key, () => {
            sessionStorage.setItem(key, serialized)
            this.memory.set(key, serialized)
        })
        this._broadcast(key, serialized, 'ss', 'set')
        this._emit(key, this.deser(serialized))
    }
    public async update(key: string, value: string | object) {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory(); if (!key) return;
        if (!this.has(key)) return
    
        const wk = `__waiters_${key}`
        const ws = this.memory.get(wk) as Set<(value: unknown) => void> | undefined
        const serialized = this.ser(value)
        let wrote = false
        await this._withLock(key, () => {
            if (sessionStorage.getItem(key) !== null) {
                sessionStorage.setItem(key, serialized)
                this.memory.set(key, serialized)
                wrote = true
            }
        })
        if (!wrote) return
        if (ws) { for (const resolve of ws) resolve(value); this.memory.delete(wk); }
        this._broadcast(key, serialized, 'ss', 'set')
        this._emit(key, this.deser(serialized))
    }
    public async setMany(entries: Record<string, any>): Promise<void> {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory()
        for (const [key, value] of Object.entries(entries)) { await this.set(key, value) }
    }
    public async delete(key: string) {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory()
        await this._withLock(key, () => {
            if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(key)
            this.memory.delete(key)
        })
        this._broadcast(key, '', 'ss', 'delete')
        this._emit(key, undefined)
    }
    public async deleteMany(keys: string[]) {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory()
        for (const k of keys) { await this.delete(k); }
    }
    public subscribe<T>(key: string, cb: (value: T) => void): () => void {
        if (typeof window === 'undefined') return () => { }
        let set = this.subscribers.get(key)
        if (!set) {
            set = new Set()
            this.subscribers.set(key, set)
        }
        set.add(cb)
        const current = this._peek(key)
        if (current !== undefined) cb(current)
        return () => {
            const s = this.subscribers.get(key)
            if (!s) return
            s.delete(cb)
            if (s.size === 0) this.subscribers.delete(key)
        }
    }
    public clear() {
        if (typeof window === 'undefined') return
        if (typeof sessionStorage !== 'undefined') {
            const root = sessionStorage.getItem(ROOT_REG)
            sessionStorage.clear()
            if (root !== null) sessionStorage.setItem(ROOT_REG, root)
        }
        this.memory.clear()
        this.subscribers.clear()
    }
    private _emit(key: string, value: any) {
        if (typeof window === 'undefined') return
        const set = this.subscribers.get(key)
        if (!set) return
        for (const cb of set) {
            try { cb(value) } catch (e) { console.error('[ss] subscriber threw', key, e) }
        }
    }
    private _peek(key: string): any {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory(); if (!key) return undefined;
        if (this.memory.has(key)) { return this.deser(this.memory.get(key) as string) }
        const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null
        return this.deser(raw)
    }
    public has(key: string): boolean {
        if (typeof window === 'undefined') return false
        if (this.memory.has(key)) return true
        if (typeof sessionStorage === 'undefined') return false
        return sessionStorage.getItem(key) !== null
    }
    public waitFor<T>(key: string, timeoutMs = 30_000): Promise<T> {
        if (typeof window === 'undefined') return new Promise<T>(() => {})
        if (this.ttl_active) this.touchMemory()
        const existing = this._peek(key)
        if (existing !== undefined) return Promise.resolve(existing)
    
        return new Promise<T>((resolve, reject) => {
            const waiterKey = `__waiters_${key}`
            const waiters = (this.memory.get(waiterKey) as Set<any>) ?? new Set<any>()
            this.memory.set(waiterKey, waiters)
    
            const timer = setTimeout(() => {
                waiters.delete(wrapped)
                if (waiters.size === 0) this.memory.delete(waiterKey)
                reject(new Error(`[ss] waitFor timeout: ${key}`))
            }, timeoutMs)
    
            const wrapped = (v: T) => { clearTimeout(timer); resolve(v) }
            waiters.add(wrapped)
        })
    }
}

export const session = new SESSION()

interface SauronState {
  get<T>(key: string | symbol, opts?: ScopeOptions): T | undefined
  set<T>(key: string | symbol, value: T | ((prev: T | undefined) => T), opts?: { triggerRender?: boolean } & ScopeOptions): void
  delete(key: string | symbol, opts?: ScopeOptions): boolean
  getByPrefix<T>(prefix: string, opts?: ScopeOptions): { key: string; value: T }[]
  getAll<T = any>(opts?: ScopeOptions): Record<string | symbol, T>
  subscribe<T>(key: string | symbol, listener: (value: T) => void, opts?: ScopeOptions): () => void
  subscribeAll(listener: (key: string | symbol, value: any) => void, opts?: ScopeOptions): () => void
  clear(opts?: ScopeOptions): void
  waitFor<T = any>(key: string | symbol, opts: ScopeOptions): Promise<T>
  batch?(key: any, fn: () => void): void
}

export function getNestedStoreMap<K, V>(sl_reg: any = SLAVE_REG, ms_reg: any = MASTER_REG, globalKey: any = ROOT_REG,): Map<K, V> {
    let root = session.get(globalKey)
    if (!root) {
        root = new Map<any, Map<any, Map<any, any>>>()
        session.set(globalKey, root)
    }

    let masterMap = root.get(ms_reg)
    if (!masterMap) {
        masterMap = new Map<any, Map<any, any>>();
        root.set(ms_reg, masterMap);
    }

    let slaveMap = masterMap.get(sl_reg)
    if (!slaveMap) {
        slaveMap = new Map<K, V>();
        masterMap.set(sl_reg, slaveMap);
    }
    return slaveMap
}
export const session_store = {
    get<T>(key: any, opts: ScopeOptions = {}): T | undefined {
        const { sl_reg, ms_reg, globalKey } = opts
        const _state = getNestedStoreMap<any, any>(sl_reg, ms_reg, globalKey)
        if (_state.has(key)) return _state.get(key)
    
        const _persistent = getNestedStoreMap<any, any>(sl_reg ? `${sl_reg}_PERSISTENT` : undefined, ms_reg, globalKey)
        const _persistKeys = getNestedStoreMap<any, boolean>(sl_reg ? `${sl_reg}_PERSIST_KEYS` : undefined, ms_reg, globalKey)
        if (_persistKeys.has(key) && _persistent.has(key)) return _persistent.get(key)
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
// #region ████████████████████████████████████ STATE █████████████████████████████████████████
export function getScopedStateMetadata(sl_reg: any = SLAVE_REG, ms_reg: any = MASTER_REG, globalKey: any = ROOT_REG) {
    let root = session.get(globalKey)

    if (!root) {
        root = new Map<any, Map<any, Map<any, any>>>()
        session.set(globalKey, root)
    }

    let masterMap = root.get(ms_reg)
    if (!masterMap) {
        masterMap = new Map<any, Map<any, any>>()
        root.set(ms_reg, masterMap)
    }

    let metaMap = masterMap.get(`${sl_reg}_META`)
    if (!metaMap) {
        metaMap = {
            _batches: new Set<string | symbol>(),
            _batchQueue: new Map<string | symbol, any>(),
            _batchOpts: new Map<string | symbol, { triggerRender?: boolean }>(),
            _globalListeners: new Set<(key: string | symbol, value: any) => void>(),
            _waiters: new Map<string | symbol, Set<(value: any) => void>>()
        }
        masterMap.set(`${sl_reg}_META`, metaMap)
    }

    return metaMap
}
export const session_state = {
    get<T>(key: string | symbol, opts: ScopeOptions = {}): T | undefined { return session_store.get<T>(key, opts) },
    set<T>(key: string | symbol, value: T | ((prev: T | undefined) => T), opts: { triggerRender?: boolean } & ScopeOptions = {}): void {
        const { sl_reg, ms_reg, globalKey, triggerRender = true } = opts
        const meta = getScopedStateMetadata(sl_reg, ms_reg, globalKey)

        if (meta._batches.has(key)) {
            const prev = session_store.get<T>(key, opts)
            const next = typeof value === 'function' ? (value as (prev: T | undefined) => T)(prev) : value
            meta._batchQueue.set(key, next)
            meta._batchOpts.set(key, { triggerRender })
            return
        }
        session_store.set(key, value, { triggerRender, sl_reg, ms_reg, globalKey })

        if (triggerRender) {
            const finalVal = session_store.get(key, opts)
            for (const listener of meta._globalListeners) {
                try { listener(key, finalVal) } catch (err) { console.error(`[Sauron Global Listener Error]:`, err) }
            }
        }
    },
    delete(key: string | symbol, opts: ScopeOptions = {}): boolean {
        const { sl_reg, ms_reg, globalKey } = opts
        const meta = getScopedStateMetadata(sl_reg, ms_reg, globalKey)

        meta._batchQueue.delete(key)
        meta._batchOpts.delete(key)
        const deleted = session_store.delete(key, opts)

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
        return session_store.entries<T>(opts)
            .filter(([key]) => typeof key === 'string' && key.startsWith(prefix))
            .map(([key, value]) => ({ key: key as string, value }))
    },
    getAll<T = any>(opts: ScopeOptions = {}): Record<string | symbol, T> {
        const result: Record<string | symbol, T> = {}
        for (const [key, value] of session_store.entries<T>(opts)) {
            result[key] = value
        }
        return result
    },
    subscribe<T>(key: string | symbol, listener: (value: T) => void, opts: ScopeOptions = {}): () => void {
        return session_store.subscribe<T>(key, listener, opts)
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
                session_store.set(key, value, { ...batchOpts, sl_reg, ms_reg, globalKey })
            }
        } finally {
            meta._batches.delete(key)
        }
    },
    clear(opts: ScopeOptions = {}): void {
        const { sl_reg, ms_reg, globalKey } = opts
        const meta = getScopedStateMetadata(sl_reg, ms_reg, globalKey)
        session_store.clear(opts)
        meta._batches.clear()
        meta._batchQueue.clear()
        meta._batchOpts.clear()
        meta._globalListeners.clear()
    }
}

export interface ScopeOptions {
    sl_reg?: any
    ms_reg?: any
    globalKey?: any
}
export interface OptimisticHookState  {
    previousValue: any
    isPending: boolean
}
export interface SStorageContext<T = any> {
    id: string
    DefaultValue?: T
    Provider?: any

    sl_reg?: string
    ms_reg?: string
    globalKey?: string
}
export interface SStorageState {
    get<T>(key: string, opts?: ScopeOptions): T | undefined
    set<T>(key: string, value: T | ((prev: T | undefined) => T), opts?: { triggerRender?: boolean } & ScopeOptions): void
    delete(key: string, opts?: ScopeOptions): boolean
    getByPrefix<T>(prefix: string, opts?: ScopeOptions): { key: string; value: T }[]
    getAll<T = any>(opts?: ScopeOptions): Record<string, T>
    subscribe<T>(key: string, listener: (value: T) => void, opts?: ScopeOptions): () => void
    subscribeAll(listener: (key: string, value: any) => void, opts?: ScopeOptions): () => void
    batch(key: string, fn: () => void, opts?: ScopeOptions): void
    clear(opts?: ScopeOptions): void
}
export interface SauronRegistry extends SauronState {
    name: string
    destroy(): void
}

export interface SauronContext<T> {
    id: string;
    DefaultValue?: T;
    Provider?: any;
    sl_reg?: string
    ms_reg?: string
    globalKey?: string
}
export function publishSSC(key: string | symbol, value: any, opts?: ScopeOptions): void { session_state.set(key, value, opts) }
export function subscribeSSC<T = any>(key: string | symbol, listener: (value: T) => void, opts?: ScopeOptions): () => void { return session_state.subscribe<T>(key, listener, opts) }
export function getAllSSC<T = any>(opts?: ScopeOptions): Record<string | symbol, T> { return session_state.getAll<T>(opts) }
export function setSSC<T>(label: string, value: T, triggerRender = true, sl_reg?: any, ms_reg?: any, globalKey?: any): void {
    if (!label) return
    session_state.set(label, value, { triggerRender, sl_reg, ms_reg, globalKey })
}
export function getSSC<T>(label: string, sl_reg?: any, ms_reg?: any, globalKey?: any): T | undefined {
    if (!label) return undefined
    return session_state.get<T>(label, { sl_reg, ms_reg, globalKey })
}
export function subSSC<T>(label: string, fn: (value: T) => void, sl_reg?: any, ms_reg?: any, globalKey?: any): () => void {
    if (!label || !fn) return () => { }
    return session_state.subscribe<T>(label, fn, { sl_reg, ms_reg, globalKey })
}
export function deleteSSC(label: string, sl_reg?: any, ms_reg?: any, globalKey?: any): boolean {
    if (!label) return false
    return session_state.delete(label, { sl_reg, ms_reg, globalKey })
}
export function subAllSSC(fn: (key: string | symbol, value: any) => void, sl_reg?: any, ms_reg?: any, globalKey?: any): () => void {
    if (!fn) return () => { }
    return session_state.subscribeAll(fn, { sl_reg, ms_reg, globalKey })
}
