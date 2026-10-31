export const isBrowser = typeof window !== 'undefined';

export class INDEXED_DB {
    public rt: A
    public ms: A
    public sl: A
    public k: A
    private _db: IDBDatabase | null = null
    private _isOpen: boolean = false

    private ttl_active = false
    private ttl_minutes = 30
    protected memoryTimer?: ReturnType<typeof setTimeout>

    protected touchMemory() {
        if (this.memoryTimer) clearTimeout(this.memoryTimer)
        this.memoryTimer = setTimeout(() => {
            this.memory.clear()
            this.memoryTimer = undefined
        }, this.ttl_minutes * 60 * 1000)
    }
    protected memory = new Map<string, unknown>()
    public _channel?: BroadcastChannel
    public _localChange = false
    private subscribers = new Map<string, Set<(value: any) => void>>()

    constructor(k:A ='_DB_STORE_NAME_LAYER_', sl:A = '_DB_NAME_LAYER_',ms:A = '_HADRON_DISRUPTOR_', rt: A = '_THE_HADRON_PARTICLE_DISRUPTOR_SINULARITY_') {
        this.rt = rt
        this.ms = ms
        this.sl = sl
        this.k = k
        if (typeof BroadcastChannel !== 'undefined') {
            this._channel = new BroadcastChannel('sauron_storage_sync')
            this._channel.onmessage = (e) => {
                if (this._localChange) { this._localChange = false; return }

                const { key, value, storageType, fn } = e.data
                if (storageType !== 'idb') return

                if (fn === 'delete') {
                    this.memory.delete(key)
                    this._emit(key, undefined)
                } else {
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
        this._localChange = true
        this._channel?.postMessage({ key, value, storageType, fn, path, domain, options })
    }
    private async _withLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
        if (typeof navigator !== 'undefined' && navigator.locks) {
            return navigator.locks.request('idb_write_' + key, fn) as Promise<T>
        }
        return fn()
    }
    // ─── OPEN / TX / REQ ───────────────────────────────────────────
    private open(__db = this._db): Promise<IDBDatabase> {
        if (__db) return Promise.resolve(__db)
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.sl, 1)
            req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(this.k)) { req.result.createObjectStore(this.k) } }
            req.onsuccess = () => {
                this._db = req.result
                this._isOpen = true
                resolve(req.result)
            }
            req.onerror = () => reject(req.error)
        })
    }
    private tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
        return this.open().then(db => db.transaction(this.k, mode).objectStore(this.k))
    }
    private req<T>(r: IDBRequest<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            r.onsuccess = () => resolve(r.result)
            r.onerror = () => reject(r.error)
        })
    }
    // ─── CORE CRUD ─────────────────────────────────────────────────
    public async get(key: string): Promise<any> {
        if (typeof window === 'undefined') return null
        if (this.ttl_active) this.touchMemory()
        if (!key) return null
        const cached = this.memory.get(key)
        if (cached !== undefined) return this.deser(cached as string)
        const store = await this.tx('readonly')
        const val = await this.req(store.get(key))
        if (val !== undefined && val !== null) this.memory.set(key, this.ser(val))
        return this.deser(val as string) ?? null
    }
    public async getMany(keys: string[]): Promise<Record<string, any>> {
        if (typeof window === 'undefined') return {}
        if (this.ttl_active) this.touchMemory()
        const result: Record<string, any> = {}
        for (const key of keys) { result[key] = await this.get(key) }
        return result
    }
    public async set(key: string, value: string | object): Promise<void> {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory(); if (!key) return;

        const wk = `__waiters_${key}`
        const ws = this.memory.get(wk) as Set<(value: unknown) => void> | undefined
        if (ws) { for (const resolve of ws) resolve(value); this.memory.delete(wk); }

        const serialized = this.ser(value)
        await this._withLock(key, async () => {
            const store = await this.tx('readwrite')
            await this.req(store.put(serialized, key))
            this.memory.set(key, serialized)
        })
        this._broadcast(key, serialized, 'idb', 'set')
        this._emit(key, this.deser(serialized))
    }
    public async update(key: string, value: string | object): Promise<void> {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory(); if (!key) return;
        if (!(await this.has(key))) return

        const wk = `__waiters_${key}`
        const ws = this.memory.get(wk) as Set<(value: unknown) => void> | undefined
        const serialized = this.ser(value)
        if (ws) { for (const resolve of ws) resolve(value); this.memory.delete(wk); }

        await this._withLock(key, async () => {
            const store = await this.tx('readwrite')
            const existing = await this.req(store.get(key))
            if (existing !== undefined && existing !== null) {
                await this.req(store.put(serialized, key))
                this.memory.set(key, serialized)
            }
        })
        this._broadcast(key, serialized, 'idb', 'set')
        this._emit(key, this.deser(serialized))
    }
    public async setMany(entries: Record<string, any>): Promise<void> {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory()
        for (const [key, value] of Object.entries(entries)) { await this.set(key, value) }
    }
    public async delete(key: string): Promise<void> {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory()
        await this._withLock(key, async () => {
            const store = await this.tx('readwrite')
            await this.req(store.delete(key))
            this.memory.delete(key)
        })
        this._broadcast(key, '', 'idb', 'delete')
        this._emit(key, undefined)
    }
    public async deleteMany(keys: string[]): Promise<void> {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory()
        for (const k of keys) { await this.delete(k) }
    }
    public async has(key: string): Promise<boolean> {
        if (typeof window === 'undefined') return false
        if (!key) return false
        if (this.memory.has(key)) return true
        const store = await this.tx('readonly')
        const val = await this.req(store.get(key))
        return val !== undefined && val !== null
    }
    public async clear(): Promise<void> {
        if (typeof window === 'undefined') return
        const store = await this.tx('readwrite')
        await this.req(store.clear())
        this.memory.clear()
        this.subscribers.clear()
    }
    public async keys(): Promise<string[]> {
        const store = await this.tx('readonly')
        const k = await this.req(store.getAllKeys())
        return k as string[]
    }
    // ─── PUB/SUB ───────────────────────────────────────────────────
    public subscribe<T>(key: string, cb: (value: T) => void): () => void {
        if (typeof window === 'undefined') return () => { }
        let set = this.subscribers.get(key)
        if (!set) {
            set = new Set()
            this.subscribers.set(key, set)
        }
        set.add(cb)
        const cached = this.memory.get(key)
        if (cached !== undefined) cb(this.deser(cached as string))
        return () => {
            const s = this.subscribers.get(key)
            if (!s) return
            s.delete(cb)
            if (s.size === 0) this.subscribers.delete(key)
        }
    }
    private _emit(key: string, value: any) {
        if (typeof window === 'undefined') return
        const set = this.subscribers.get(key)
        if (!set) return
        for (const cb of set) {
            try { cb(value) } catch (e) { console.error('[idb] subscriber threw', key, e) }
        }
    }
    private _peek(key: string): any {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory(); if (!key) return undefined;
        const cached = this.memory.get(key)
        return cached === undefined ? undefined : this.deser(cached as string)
    }
    // ─── WAIT ──────────────────────────────────────────────────────
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
    // ─── CLOSE ─────────────────────────────────────────────────────
    close(): void {
        if (this._db) {
            this._db.close()
            this._isOpen = false
            this._db = null
        }
    }
    isOpen(): boolean {
        return this._isOpen
    }
    getDatabaseInfo(): any {
        return {
            isOpen: this._isOpen,
            type: 'IndexedDB',
            sl: this.sl,
            k: this.k,
            hasDb: !!this._db,
        }
    }
    // ─── INDEXEDDB HELPERS ─────────────────────────────────────────
    async getAllItems(): Promise<Record<string, string>> {
        const store = await this.tx('readonly')
        const keys = await this.req(store.getAllKeys()) as string[]
        const result: Record<string, string> = {}
        for (const key of keys) {
            const value = await this.req(store.get(key))
            if (value !== null && value !== undefined) result[key] = value as string
        }
        return result
    }
    async getAllKeys(): Promise<string[]> {
        const store = await this.tx('readonly')
        return await this.req(store.getAllKeys()) as string[]
    }
    async getAllValues(): Promise<string[]> {
        const store = await this.tx('readonly')
        return await this.req(store.getAll()) as string[]
    }
    async count(): Promise<number> {
        const store = await this.tx('readonly')
        return await this.req(store.count())
    }
    // ─── INDEX MANAGEMENT ──────────────────────────────────────────
    async createIndex(indexName: string, keyPath: string, options?: IDBIndexParameters): Promise<void> {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.sl, 2)
            req.onupgradeneeded = () => {
                const store = req.transaction!.objectStore(this.k)
                if (!store.indexNames.contains(indexName)) {
                    store.createIndex(indexName, keyPath, options)
                }
            }
            req.onsuccess = () => { req.result.close(); resolve() }
            req.onerror = () => reject(req.error)
        })
    }
    
    async deleteIndex(indexName: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.sl, 2)
            req.onupgradeneeded = () => {
                const store = req.transaction!.objectStore(this.k)
                if (store.indexNames.contains(indexName)) {
                    store.deleteIndex(indexName)
                }
            }
            req.onsuccess = () => { req.result.close(); resolve() }
            req.onerror = () => reject(req.error)
        })
    }
    async getByIndex(indexName: string, value: any): Promise<any> {
        const store = await this.tx('readonly')
        const index = store.index(indexName)
        return await this.req(index.get(value))
    }
    async getAllByIndex(indexName: string, value: any): Promise<any[]> {
        const store = await this.tx('readonly')
        const index = store.index(indexName)
        return await this.req(index.getAll(value))
    }
    async getKeysByIndex(indexName: string, value: any): Promise<string[]> {
        const store = await this.tx('readonly')
        const index = store.index(indexName)
        return await this.req(index.getAllKeys(value)) as string[]
    }
    // ─── CURSOR ────────────────────────────────────────────────────
    async iterateAll(callback: (key: string, value: string) => void): Promise<void> {
        const store = await this.tx('readonly')
        const cursor = store.openCursor()
        return new Promise((resolve, reject) => {
            cursor.onsuccess = () => {
                const c = cursor.result
                if (c) {
                    callback(c.key as string, c.value)
                    c.continue()
                } else {
                    resolve()
                }
            }
            cursor.onerror = () => reject(cursor.error)
        })
    }
    // ─── USE FOR RDB VERSION ─────────────────────────────────────
}

export const indexed_db = new INDEXED_DB()
