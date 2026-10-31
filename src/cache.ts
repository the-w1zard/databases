
export class CACHE {
    private ttl_active = false
    private ttl_minutes = 10
    protected memoryTimer?: ReturnType<typeof setTimeout>

    protected touchMemory() {
        if (this.memoryTimer) clearTimeout(this.memoryTimer)
        this.memoryTimer = setTimeout(() => {
            this.memory.clear()
            this.mem.clear()
            this.memoryTimer = undefined
        }, this.ttl_minutes * 60 * 1000)
    }

    protected mem = new Map<string, string>()
    protected memory = new Map<string, unknown>()
    public _channel?: BroadcastChannel
    public _localChange = false
    private subscribers = new Map<string, Set<(value: any) => void>>()

    constructor() {
        if (typeof BroadcastChannel !== 'undefined') {
            this._channel = new BroadcastChannel('sauron_storage_sync')
            this._channel.onmessage = (e) => {
                if (this._localChange) { this._localChange = false; return; }

                const { key, value, storageType, fn } = e.data
                if (storageType !== 'mem') return

                if (fn === 'delete') {
                    this.mem.delete(key)
                    this._emit(key, undefined)
                } else {
                    this.mem.set(key, value)
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
        this._localChange = true
        this._channel?.postMessage({ key, value, storageType, fn, path, domain, options })
    }
    private async _withLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
        if (typeof navigator !== 'undefined' && navigator.locks) {
            return navigator.locks.request('mem_write_' + key, fn) as Promise<T>
        }
        return fn()
    }

    // #region ███ MEMORY ██████████████████████████████████████████████████████
    public get(key: string) {
        if (typeof window === 'undefined') return null
        if (this.ttl_active) this.touchMemory()
        if (!key) return null
        const v = this.mem.get(key)
        return v === undefined ? null : this.deser(v)
    }
    public async getMany(keys: string[]): Promise<Record<string, any>> {
        if (typeof window === 'undefined') return {}
        if (this.ttl_active) this.touchMemory()
        const out: Record<string, any> = {}
        for (const k of keys) {
            const v = await this.get(k)
            if (v !== null && v !== undefined) out[k] = v
        }
        return out
    }
    public async set(key: string, value: any) {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory(); if (!key) return;

        const wk = `__waiters_${key}`
        const ws = this.memory.get(wk) as Set<(value: unknown) => void> | undefined
        if (ws) { for (const resolve of ws) resolve(value); this.memory.delete(wk); }

        const serialized = this.ser(value)
        await this._withLock(key, () => {
            this.mem.set(key, serialized)
        })
        this._broadcast(key, serialized, 'mem', 'set')
        this._emit(key, this.deser(serialized))
    }
    public async update(key: string, value: any) {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory(); if (!key) return;
        if (!this.has(key)) return

        const wk = `__waiters_${key}`
        const ws = this.memory.get(wk) as Set<(value: unknown) => void> | undefined
        const serialized = this.ser(value)
        if (ws) { for (const resolve of ws) resolve(value); this.memory.delete(wk); }
        await this._withLock(key, () => {
            if (this.mem.has(key)) this.mem.set(key, serialized)
        })
        this._broadcast(key, serialized, 'mem', 'set')
        this._emit(key, this.deser(serialized))
    }
    public async setMany(entries: Record<string, any>): Promise<void> {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory()
        for (const [k, v] of Object.entries(entries)) { await this.set(k, v); }
    }
    public async delete(key: string) {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory()
        await this._withLock(key, () => {
            this.mem.delete(key)
        })
        this._broadcast(key, '', 'mem', 'delete')
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
        this.mem.clear()
        this.memory.clear()
        this.subscribers.clear()
    }
    private _emit(key: string, value: any) {
        if (typeof window === 'undefined') return
        const set = this.subscribers.get(key)
        if (!set) return
        for (const cb of set) {
            try { cb(value) } catch (e) { console.error('[mem] subscriber threw', key, e) }
        }
    }
    private _peek(key: string): any {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory(); if (!key) return undefined;
        const v = this.mem.get(key)
        return v === undefined ? undefined : this.deser(v)
    }
    public has(key: string): boolean {
        if (typeof window === 'undefined') return false
        if (!key) return false
        return this.mem.has(key)
    }
    public waitFor<T>(key: string): Promise<T> {
        if (typeof window === 'undefined') return new Promise<T>((resolve) => { })
        if (this.ttl_active) this.touchMemory()
        const existing = this._peek(key)
        if (existing !== undefined) return Promise.resolve(existing)

        return new Promise<T>((resolve) => {
            const waiterKey = `__waiters_${key}`
            let waiters = this.memory.get(waiterKey) as Set<(value: T) => void> | undefined

            if (!waiters) {
                waiters = new Set<(value: T) => void>()
                this.memory.set(waiterKey, waiters)
            }

            waiters.add(resolve)
        })
    }
    // #endregion
}

export const cache = new CACHE()



