export const isBrowser = typeof window !== 'undefined';
export class INDEXED_DB {
    rt;
    ms;
    sl;
    k;
    _db = null;
    _isOpen = false;
    ttl_active = false;
    ttl_minutes = 30;
    memoryTimer;
    touchMemory() {
        if (this.memoryTimer)
            clearTimeout(this.memoryTimer);
        this.memoryTimer = setTimeout(() => {
            this.memory.clear();
            this.memoryTimer = undefined;
        }, this.ttl_minutes * 60 * 1000);
    }
    memory = new Map();
    _channel;
    _localChange = false;
    subscribers = new Map();
    constructor(k = '_DB_STORE_NAME_LAYER_', sl = '_DB_NAME_LAYER_', ms = '_HADRON_DISRUPTOR_', rt = '_THE_HADRON_PARTICLE_DISRUPTOR_SINULARITY_') {
        this.rt = rt;
        this.ms = ms;
        this.sl = sl;
        this.k = k;
        if (typeof BroadcastChannel !== 'undefined') {
            this._channel = new BroadcastChannel('sauron_storage_sync');
            this._channel.onmessage = (e) => {
                if (this._localChange) {
                    this._localChange = false;
                    return;
                }
                const { key, value, storageType, fn } = e.data;
                if (storageType !== 'idb')
                    return;
                if (fn === 'delete') {
                    this.memory.delete(key);
                    this._emit(key, undefined);
                }
                else {
                    this.memory.set(key, value);
                    this._emit(key, this.deser(value));
                }
            };
        }
    }
    ser(value) {
        if (value instanceof Map) {
            return JSON.stringify({ __type: 'Map', value: Array.from(value.entries()).map(([key, val]) => [this.ser(key), this.ser(val)]) });
        }
        if (value instanceof Set) {
            return JSON.stringify({ __type: 'Set', value: Array.from(value.values()).map(value => this.ser(value)) });
        }
        return typeof value === 'string' ? value : JSON.stringify(value);
    }
    deser(raw) {
        if (raw === null)
            return null;
        try {
            const parsed = JSON.parse(raw);
            if (parsed?.__type === 'Map') {
                return new Map(parsed.value.map(([key, value]) => [this.deser(key), this.deser(value)]));
            }
            if (parsed?.__type === 'Set') {
                return new Set(parsed.value.map((value) => this.deser(value)));
            }
            return parsed;
        }
        catch {
            return raw;
        }
    }
    _broadcast(key, value, storageType, fn, path, domain, options) {
        this._localChange = true;
        this._channel?.postMessage({ key, value, storageType, fn, path, domain, options });
    }
    async _withLock(key, fn) {
        if (typeof navigator !== 'undefined' && navigator.locks) {
            return navigator.locks.request('idb_write_' + key, fn);
        }
        return fn();
    }
    // ─── OPEN / TX / REQ ───────────────────────────────────────────
    open(__db = this._db) {
        if (__db)
            return Promise.resolve(__db);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.sl, 1);
            req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(this.k)) {
                req.result.createObjectStore(this.k);
            } };
            req.onsuccess = () => {
                this._db = req.result;
                this._isOpen = true;
                resolve(req.result);
            };
            req.onerror = () => reject(req.error);
        });
    }
    tx(mode) {
        return this.open().then(db => db.transaction(this.k, mode).objectStore(this.k));
    }
    req(r) {
        return new Promise((resolve, reject) => {
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
        });
    }
    // ─── CORE CRUD ─────────────────────────────────────────────────
    async get(key) {
        if (typeof window === 'undefined')
            return null;
        if (this.ttl_active)
            this.touchMemory();
        if (!key)
            return null;
        const cached = this.memory.get(key);
        if (cached !== undefined)
            return this.deser(cached);
        const store = await this.tx('readonly');
        const val = await this.req(store.get(key));
        if (val !== undefined && val !== null)
            this.memory.set(key, this.ser(val));
        return this.deser(val) ?? null;
    }
    async getMany(keys) {
        if (typeof window === 'undefined')
            return {};
        if (this.ttl_active)
            this.touchMemory();
        const result = {};
        for (const key of keys) {
            result[key] = await this.get(key);
        }
        return result;
    }
    async set(key, value) {
        if (typeof window === 'undefined')
            return;
        if (this.ttl_active)
            this.touchMemory();
        if (!key)
            return;
        const wk = `__waiters_${key}`;
        const ws = this.memory.get(wk);
        if (ws) {
            for (const resolve of ws)
                resolve(value);
            this.memory.delete(wk);
        }
        const serialized = this.ser(value);
        await this._withLock(key, async () => {
            const store = await this.tx('readwrite');
            await this.req(store.put(serialized, key));
            this.memory.set(key, serialized);
        });
        this._broadcast(key, serialized, 'idb', 'set');
        this._emit(key, this.deser(serialized));
    }
    async update(key, value) {
        if (typeof window === 'undefined')
            return;
        if (this.ttl_active)
            this.touchMemory();
        if (!key)
            return;
        if (!(await this.has(key)))
            return;
        const wk = `__waiters_${key}`;
        const ws = this.memory.get(wk);
        const serialized = this.ser(value);
        if (ws) {
            for (const resolve of ws)
                resolve(value);
            this.memory.delete(wk);
        }
        await this._withLock(key, async () => {
            const store = await this.tx('readwrite');
            const existing = await this.req(store.get(key));
            if (existing !== undefined && existing !== null) {
                await this.req(store.put(serialized, key));
                this.memory.set(key, serialized);
            }
        });
        this._broadcast(key, serialized, 'idb', 'set');
        this._emit(key, this.deser(serialized));
    }
    async setMany(entries) {
        if (typeof window === 'undefined')
            return;
        if (this.ttl_active)
            this.touchMemory();
        for (const [key, value] of Object.entries(entries)) {
            await this.set(key, value);
        }
    }
    async delete(key) {
        if (typeof window === 'undefined')
            return;
        if (this.ttl_active)
            this.touchMemory();
        await this._withLock(key, async () => {
            const store = await this.tx('readwrite');
            await this.req(store.delete(key));
            this.memory.delete(key);
        });
        this._broadcast(key, '', 'idb', 'delete');
        this._emit(key, undefined);
    }
    async deleteMany(keys) {
        if (typeof window === 'undefined')
            return;
        if (this.ttl_active)
            this.touchMemory();
        for (const k of keys) {
            await this.delete(k);
        }
    }
    async has(key) {
        if (typeof window === 'undefined')
            return false;
        if (!key)
            return false;
        if (this.memory.has(key))
            return true;
        const store = await this.tx('readonly');
        const val = await this.req(store.get(key));
        return val !== undefined && val !== null;
    }
    async clear() {
        if (typeof window === 'undefined')
            return;
        const store = await this.tx('readwrite');
        await this.req(store.clear());
        this.memory.clear();
        this.subscribers.clear();
    }
    async keys() {
        const store = await this.tx('readonly');
        const k = await this.req(store.getAllKeys());
        return k;
    }
    // ─── PUB/SUB ───────────────────────────────────────────────────
    subscribe(key, cb) {
        if (typeof window === 'undefined')
            return () => { };
        let set = this.subscribers.get(key);
        if (!set) {
            set = new Set();
            this.subscribers.set(key, set);
        }
        set.add(cb);
        const cached = this.memory.get(key);
        if (cached !== undefined)
            cb(this.deser(cached));
        return () => {
            const s = this.subscribers.get(key);
            if (!s)
                return;
            s.delete(cb);
            if (s.size === 0)
                this.subscribers.delete(key);
        };
    }
    _emit(key, value) {
        if (typeof window === 'undefined')
            return;
        const set = this.subscribers.get(key);
        if (!set)
            return;
        for (const cb of set) {
            try {
                cb(value);
            }
            catch (e) {
                console.error('[idb] subscriber threw', key, e);
            }
        }
    }
    _peek(key) {
        if (typeof window === 'undefined')
            return;
        if (this.ttl_active)
            this.touchMemory();
        if (!key)
            return undefined;
        const cached = this.memory.get(key);
        return cached === undefined ? undefined : this.deser(cached);
    }
    // ─── WAIT ──────────────────────────────────────────────────────
    waitFor(key) {
        if (typeof window === 'undefined')
            return new Promise((resolve) => { });
        if (this.ttl_active)
            this.touchMemory();
        const existing = this._peek(key);
        if (existing !== undefined)
            return Promise.resolve(existing);
        return new Promise((resolve) => {
            const waiterKey = `__waiters_${key}`;
            let waiters = this.memory.get(waiterKey);
            if (!waiters) {
                waiters = new Set();
                this.memory.set(waiterKey, waiters);
            }
            waiters.add(resolve);
        });
    }
    // ─── CLOSE ─────────────────────────────────────────────────────
    close() {
        if (this._db) {
            this._db.close();
            this._isOpen = false;
            this._db = null;
        }
    }
    isOpen() {
        return this._isOpen;
    }
    getDatabaseInfo() {
        return {
            isOpen: this._isOpen,
            type: 'IndexedDB',
            sl: this.sl,
            k: this.k,
            hasDb: !!this._db,
        };
    }
    // ─── INDEXEDDB HELPERS ─────────────────────────────────────────
    async getAllItems() {
        const store = await this.tx('readonly');
        const keys = await this.req(store.getAllKeys());
        const result = {};
        for (const key of keys) {
            const value = await this.req(store.get(key));
            if (value !== null && value !== undefined)
                result[key] = value;
        }
        return result;
    }
    async getAllKeys() {
        const store = await this.tx('readonly');
        return await this.req(store.getAllKeys());
    }
    async getAllValues() {
        const store = await this.tx('readonly');
        return await this.req(store.getAll());
    }
    async count() {
        const store = await this.tx('readonly');
        return await this.req(store.count());
    }
    // ─── INDEX MANAGEMENT ──────────────────────────────────────────
    async createIndex(indexName, keyPath, options) {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.sl, 2);
            req.onupgradeneeded = () => {
                const store = req.transaction.objectStore(this.k);
                if (!store.indexNames.contains(indexName)) {
                    store.createIndex(indexName, keyPath, options);
                }
            };
            req.onsuccess = () => { req.result.close(); resolve(); };
            req.onerror = () => reject(req.error);
        });
    }
    async deleteIndex(indexName) {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.sl, 2);
            req.onupgradeneeded = () => {
                const store = req.transaction.objectStore(this.k);
                if (store.indexNames.contains(indexName)) {
                    store.deleteIndex(indexName);
                }
            };
            req.onsuccess = () => { req.result.close(); resolve(); };
            req.onerror = () => reject(req.error);
        });
    }
    async getByIndex(indexName, value) {
        const store = await this.tx('readonly');
        const index = store.index(indexName);
        return await this.req(index.get(value));
    }
    async getAllByIndex(indexName, value) {
        const store = await this.tx('readonly');
        const index = store.index(indexName);
        return await this.req(index.getAll(value));
    }
    async getKeysByIndex(indexName, value) {
        const store = await this.tx('readonly');
        const index = store.index(indexName);
        return await this.req(index.getAllKeys(value));
    }
    // ─── CURSOR ────────────────────────────────────────────────────
    async iterateAll(callback) {
        const store = await this.tx('readonly');
        const cursor = store.openCursor();
        return new Promise((resolve, reject) => {
            cursor.onsuccess = () => {
                const c = cursor.result;
                if (c) {
                    callback(c.key, c.value);
                    c.continue();
                }
                else {
                    resolve();
                }
            };
            cursor.onerror = () => reject(cursor.error);
        });
    }
}
export const indexed_db = new INDEXED_DB();
