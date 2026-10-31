

export class GT {
    ttl_minutes = 30
    ttl_active = false
    _GT_SUBSCRIBERS = new Map<string, any>()
    _GT_MEMORY = new Map<string, any>()
    memoryTimer: ReturnType<typeof setTimeout> | undefined
    protected memory = new Map<string, unknown>()
    protected _waiters = new Map<string, unknown>()
    public _channel?: BroadcastChannel
    public _localChange = false
    private subscribers = new Map<string, Set<(value: any) => void>>()
    private _globalNotifyCache = new WeakMap<any, Map<any, () => void>>()
    private _notifyCache = new WeakMap<Map<any, Set<(value: any) => void>>, Map<any, () => void>>()
    private async _withLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
        if (typeof navigator !== 'undefined' && navigator.locks) {
            return navigator.locks.request('gt_write_' + key, fn) as Promise<T>
        }
        return fn()
    }
    protected touchMemory() {
        if (this.memoryTimer) clearTimeout(this.memoryTimer)
        this.memoryTimer = setTimeout(() => {
            this.memory.clear()
            this.memoryTimer = undefined
        }, this.ttl_minutes * 60 * 1000)
    }

    constructor() {
        // ████ AUTO CROSS TAB SYNC ███████████████████████████████████████████████████████████
        if (typeof BroadcastChannel !== 'undefined') {
            this._channel = new BroadcastChannel('sauron_storage_sync')
            this._channel.onmessage = (e) => {
                if (this._localChange) { this._localChange = false; return; }

                const { key, value, storageType, fn } = e.data

                if (storageType === 'gt' && fn === 'delete') {
                    delete (globalThis as any)[key]
                    this.memory.delete(key)
                    this._emit(key, undefined)
                } else if (storageType === 'gt' && fn === 'set') {
                    (globalThis as any)[key] = value
                    this.memory.set(key, value)
                    this._emit(key, this.deser(value))
                }
            }
        }
    }
    public ser(value: U): S {
        if (value instanceof Map) {
          return JSON.stringify({ 
            __type: 'Map', 
            value: Array.from(value.entries()).map(([key, val]) => [this.ser(key), this.ser(val)]) 
          });
        }
        if (value instanceof Set) {
          return JSON.stringify({ 
            __type: 'Set', 
            value: Array.from(value.values()).map(val => this.ser(val)) 
          });
        }
        if (Array.isArray(value)) {
          return JSON.stringify({ 
            __type: 'Array', 
            value: value.map(item => this.ser(item)) 
          });
        }
        if (value !== null && typeof value === 'object') {
          const obj: Record<string, S> = {};
          for (const [key, val] of Object.entries(value)) {
            obj[key] = this.ser(val);
          }
          return JSON.stringify({ 
            __type: 'Object', 
            value: obj 
          });
        }
        // Wrap primitives (strings, numbers, booleans, null) to preserve exact types
        return JSON.stringify({ 
          __type: 'Primitive', 
          value 
        });
      }
        public deser<T=A, Z=A>(raw: S | O | M<T, Z> | SET<T> |AR<T>): A {
        if (raw === null || raw === undefined) return raw;
        try {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      
          if (parsed?.__type === 'Map') {
            return new Map(parsed.value.map(([key, val]: [S, S]) => [this.deser(key), this.deser(val)]));
          }
          if (parsed?.__type === 'Set') {
            return new Set(parsed.value.map((val: S) => this.deser(val)));
          }
          if (parsed?.__type === 'Array') {
            return parsed.value.map((val: S) => this.deser(val));
          }
          if (parsed?.__type === 'Object') {
            const obj: Record<string, any> = {};
            for (const [key, val] of Object.entries(parsed.value)) {
              obj[key] = this.deser(val as S);
            }
            return obj;
          }
          if (parsed?.__type === 'Primitive') {
            return parsed.value;
          }
      
          return parsed;
        } catch {
          return raw;
        }
      }
    _broadcast(key: string, value: any, storageType: string, fn: string, path?: string, domain?: string, options?: any) {
        this._localChange = true
        this._channel?.postMessage({ key, value, storageType, fn, path, domain, options })
    }
    async set(label: string, value: any) {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory()
        if (!label) return

        const wk = `__waiters_${label}`
        const ws = this._GT_MEMORY.get(wk) as Set<(value: unknown) => void> | undefined
        if (ws) { for (const resolve of ws) resolve(value); this._GT_MEMORY.delete(wk) }

        await this._withLock(label, () => {
            (globalThis as any)[label] = value
            this._GT_MEMORY.set(label, this.ser(value))
        })
        this._broadcast(label, this.ser(value), 'gt', 'set')
        this._emit(label, value)
    }
    async setMany(entries: Record<string, any>) {
        if (typeof window === 'undefined') return
        for (const [k, v] of Object.entries(entries)) { await this.set(k, v) }
    }
    get(label: string) {
        if (typeof window === 'undefined') return undefined
        if (this.ttl_active) this.touchMemory()
        if (!label) return undefined
        return (globalThis as any)[label]
    }
    async getMany(keys: string[]) {
        if (typeof window === 'undefined') return {}
        if (this.ttl_active) this.touchMemory()
        const out: Record<string, unknown> = {}
        for (const k of keys) {
            const v = this.get(k)
            if (v !== null && v !== undefined) out[k] = v
        }
        return out
    }
    async update(label: string, value: any) {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory()
        if (!label) return
        if (!this.has(label)) return

        const wk = `__waiters_${label}`
        const ws = this._GT_MEMORY.get(wk) as Set<(value: unknown) => void> | undefined
        if (ws) { for (const resolve of ws) resolve(value); this._GT_MEMORY.delete(wk) }

        await this._withLock(label, () => {
            if (label in (globalThis as any)) {
                (globalThis as any)[label] = value
               this. _GT_MEMORY.set(label, this.ser(value))
            }
        })
        this._broadcast(label, this.ser(value), 'gt', 'set')
        this._emit(label, value)
    }
    async delete(label: string) {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory()
        if (!label) return
        await this._withLock(label, () => {
            delete (globalThis as any)[label]
            this._GT_MEMORY.delete(label)
        })
        this._broadcast(label, '', 'gt', 'delete')
        this._emit(label, undefined)
    }
    async deleteMany(keys: string[]) {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory()
        for (const k of keys) { await this.delete(k) }
    }
    has(label: string): boolean {
        if (typeof window === 'undefined') return false
        if (!label) return false
        return label in (globalThis as any)
    }
    subscribe<T>(label: string, cb: (value: T) => void): () => void {
        if (typeof window === 'undefined') return () => { }
        let set = this._GT_SUBSCRIBERS.get(label)
        if (!set) {
            set = new Set()
            this._GT_SUBSCRIBERS.set(label, set)
        }
        set.add(cb)
        const current = this._peek(label)
        if (current !== undefined) cb(current)
        return () => {
            const s = this._GT_SUBSCRIBERS.get(label)
            if (!s) return
            s.delete(cb)
            if (s.size === 0) this._GT_SUBSCRIBERS.delete(label)
        }
    }
    clear() {
        if (typeof window === 'undefined') return
        for (const key of this._GT_MEMORY.keys()) {
            if (key.startsWith('__waiters_')) continue
            delete (globalThis as any)[key]
        }
       this._GT_MEMORY.clear()
       this. _GT_SUBSCRIBERS.clear()
    }
    _emit(label: string, value: any) {
        if (typeof window === 'undefined') return
        const set = this._GT_SUBSCRIBERS.get(label)
        if (!set) return
        for (const cb of set) {
            try { cb(value) } catch (e) { console.error('[gt] subscriber threw', label, e) }
        }
    }
    _peek(label: string): any {
        if (typeof window === 'undefined') return undefined
        if (this.ttl_active)this.touchMemory()
        if (!label) return undefined
        return (globalThis as any)[label]
    }
    async getAsync(label: string): Promise<any> {
        if (typeof window === 'undefined') return undefined
        if (this.ttl_active) this.touchMemory()
        if (!label) return undefined
        const existing = this._peek(label)
        if (existing !== undefined) return existing
        return this.waitFor(label)
    }
    waitFor<T>(key: string): Promise<T> {
        if (typeof window === 'undefined') return new Promise<T>((resolve) => { })
        if (this.ttl_active) this.touchMemory()
        const existing = this._peek(key)
        if (existing !== undefined) return Promise.resolve(existing)

        return new Promise<T>((resolve) => {
            const waiterKey = `__waiters_${key}`
            let waiters = this._GT_MEMORY.get(waiterKey) as Set<(value: T) => void> | undefined
            if (!waiters) {
                waiters = new Set<(value: T) => void>()
                this._GT_MEMORY.set(waiterKey, waiters)
            }
            waiters.add(resolve)
        })
    }

}
export const gt = new GT()
