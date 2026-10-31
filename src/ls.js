export class LS {
    ttl_active = false;
    ttl_minutes = 30;
    memoryTimer;
    touchMemory() {
        if (this.memoryTimer)
            clearTimeout(this.memoryTimer);
        this.memoryTimer = setTimeout(() => {
            this.memory.clear();
            localStorage.clear();
            this.memoryTimer = undefined;
        }, this.ttl_minutes * 60 * 1000);
    }
    memory = new Map();
    _channel;
    _localChange = false;
    subscribers = new Map();
    constructor() {
        if (typeof BroadcastChannel !== 'undefined') {
            this._channel = new BroadcastChannel('sauron_storage_sync');
            this._channel.onmessage = (e) => {
                if (this._localChange) {
                    this._localChange = false;
                    return;
                }
                const { key, value, storageType, fn } = e.data;
                if (storageType !== 'ls')
                    return;
                if (fn === 'delete') {
                    if (typeof localStorage !== 'undefined')
                        localStorage.removeItem(key);
                    this.memory.delete(key);
                }
                else {
                    if (typeof localStorage !== 'undefined')
                        localStorage.setItem(key, value);
                    this.memory.set(key, value);
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
            return navigator.locks.request('ls_write_' + key, fn);
        }
        return fn();
    }
    get(key) {
        if (typeof window === 'undefined')
            return;
        if (this.ttl_active)
            this.touchMemory();
        if (this.memory.has(key)) {
            return this.deser(this.memory.get(key));
        }
        const raw = localStorage.getItem(key);
        const v = this.deser(raw);
        if (raw !== null)
            this.memory.set(key, raw);
        return v;
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
            return {};
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
        await this._withLock(key, () => {
            localStorage.setItem(key, serialized);
            this.memory.set(key, serialized);
        });
        this._broadcast(key, serialized, 'ls', 'set');
        this._emit(key, this.deser(serialized));
    }
    async update(key, value) {
        if (typeof window === 'undefined')
            return;
        if (this.ttl_active)
            this.touchMemory();
        if (!key)
            return;
        if (!this.has(key))
            return;
        const wk = `__waiters_${key}`;
        const ws = this.memory.get(wk);
        const serialized = this.ser(value);
        if (ws) {
            for (const resolve of ws)
                resolve(value);
            this.memory.delete(wk);
        }
        await this._withLock(key, () => {
            localStorage.update(key, serialized);
            this.memory.set(key, serialized);
        });
        this._broadcast(key, serialized, 'ls', 'set');
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
        await this._withLock(key, () => {
            localStorage.removeItem(key);
            this.memory.delete(key);
        });
        this._broadcast(key, '', 'ls', 'delete');
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
    subscribe(key, cb) {
        if (typeof window === 'undefined')
            return () => { };
        let set = this.subscribers.get(key);
        if (!set) {
            set = new Set();
            this.subscribers.set(key, set);
        }
        set.add(cb);
        const current = this._peek(key);
        if (current !== undefined)
            cb(current);
        return () => {
            const s = this.subscribers.get(key);
            if (!s)
                return;
            s.delete(cb);
            if (s.size === 0)
                this.subscribers.delete(key);
        };
    }
    clear() {
        if (typeof window === 'undefined')
            return;
        localStorage.clear();
        this.memory.clear();
        this.subscribers.clear();
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
                console.error('[ls] subscriber threw', key, e);
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
        if (this.memory.has(key)) {
            return this.deser(this.memory.get(key));
        }
        return this.deser(localStorage.getItem(key));
    }
    has(key) {
        if (typeof window === 'undefined')
            return false;
        if (this.memory.has(key))
            return true;
        return localStorage.getItem(key) !== null;
    }
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
}
export const ls = new LS();
