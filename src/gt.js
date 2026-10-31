export class GT {
    ttl_minutes = 30;
    ttl_active = false;
    _GT_SUBSCRIBERS = new Map();
    _GT_MEMORY = new Map();
    memoryTimer;
    memory = new Map();
    _waiters = new Map();
    _channel;
    _localChange = false;
    subscribers = new Map();
    _globalNotifyCache = new WeakMap();
    _notifyCache = new WeakMap();
    async _withLock(key, fn) {
        if (typeof navigator !== 'undefined' && navigator.locks) {
            return navigator.locks.request('gt_write_' + key, fn);
        }
        return fn();
    }
    touchMemory() {
        if (this.memoryTimer)
            clearTimeout(this.memoryTimer);
        this.memoryTimer = setTimeout(() => {
            this.memory.clear();
            this.memoryTimer = undefined;
        }, this.ttl_minutes * 60 * 1000);
    }
    constructor() {
        // ████ AUTO CROSS TAB SYNC ███████████████████████████████████████████████████████████
        if (typeof BroadcastChannel !== 'undefined') {
            this._channel = new BroadcastChannel('sauron_storage_sync');
            this._channel.onmessage = (e) => {
                if (this._localChange) {
                    this._localChange = false;
                    return;
                }
                const { key, value, storageType, fn } = e.data;
                if (storageType === 'gt' && fn === 'delete') {
                    delete globalThis[key];
                    this.memory.delete(key);
                    this._emit(key, undefined);
                }
                else if (storageType === 'gt' && fn === 'set') {
                    globalThis[key] = value;
                    this.memory.set(key, value);
                    this._emit(key, this.deser(value));
                }
            };
        }
    }
    ser(value) {
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
            const obj = {};
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
    deser(raw) {
        if (raw === null || raw === undefined)
            return raw;
        try {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (parsed?.__type === 'Map') {
                return new Map(parsed.value.map(([key, val]) => [this.deser(key), this.deser(val)]));
            }
            if (parsed?.__type === 'Set') {
                return new Set(parsed.value.map((val) => this.deser(val)));
            }
            if (parsed?.__type === 'Array') {
                return parsed.value.map((val) => this.deser(val));
            }
            if (parsed?.__type === 'Object') {
                const obj = {};
                for (const [key, val] of Object.entries(parsed.value)) {
                    obj[key] = this.deser(val);
                }
                return obj;
            }
            if (parsed?.__type === 'Primitive') {
                return parsed.value;
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
    async set(label, value) {
        if (typeof window === 'undefined')
            return;
        if (this.ttl_active)
            this.touchMemory();
        if (!label)
            return;
        const wk = `__waiters_${label}`;
        const ws = this._GT_MEMORY.get(wk);
        if (ws) {
            for (const resolve of ws)
                resolve(value);
            this._GT_MEMORY.delete(wk);
        }
        await this._withLock(label, () => {
            globalThis[label] = value;
            this._GT_MEMORY.set(label, this.ser(value));
        });
        this._broadcast(label, this.ser(value), 'gt', 'set');
        this._emit(label, value);
    }
    async setMany(entries) {
        if (typeof window === 'undefined')
            return;
        for (const [k, v] of Object.entries(entries)) {
            await this.set(k, v);
        }
    }
    get(label) {
        if (typeof window === 'undefined')
            return undefined;
        if (this.ttl_active)
            this.touchMemory();
        if (!label)
            return undefined;
        return globalThis[label];
    }
    async getMany(keys) {
        if (typeof window === 'undefined')
            return {};
        if (this.ttl_active)
            this.touchMemory();
        const out = {};
        for (const k of keys) {
            const v = this.get(k);
            if (v !== null && v !== undefined)
                out[k] = v;
        }
        return out;
    }
    async update(label, value) {
        if (typeof window === 'undefined')
            return;
        if (this.ttl_active)
            this.touchMemory();
        if (!label)
            return;
        if (!this.has(label))
            return;
        const wk = `__waiters_${label}`;
        const ws = this._GT_MEMORY.get(wk);
        if (ws) {
            for (const resolve of ws)
                resolve(value);
            this._GT_MEMORY.delete(wk);
        }
        await this._withLock(label, () => {
            if (label in globalThis) {
                globalThis[label] = value;
                this._GT_MEMORY.set(label, this.ser(value));
            }
        });
        this._broadcast(label, this.ser(value), 'gt', 'set');
        this._emit(label, value);
    }
    async delete(label) {
        if (typeof window === 'undefined')
            return;
        if (this.ttl_active)
            this.touchMemory();
        if (!label)
            return;
        await this._withLock(label, () => {
            delete globalThis[label];
            this._GT_MEMORY.delete(label);
        });
        this._broadcast(label, '', 'gt', 'delete');
        this._emit(label, undefined);
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
    has(label) {
        if (typeof window === 'undefined')
            return false;
        if (!label)
            return false;
        return label in globalThis;
    }
    subscribe(label, cb) {
        if (typeof window === 'undefined')
            return () => { };
        let set = this._GT_SUBSCRIBERS.get(label);
        if (!set) {
            set = new Set();
            this._GT_SUBSCRIBERS.set(label, set);
        }
        set.add(cb);
        const current = this._peek(label);
        if (current !== undefined)
            cb(current);
        return () => {
            const s = this._GT_SUBSCRIBERS.get(label);
            if (!s)
                return;
            s.delete(cb);
            if (s.size === 0)
                this._GT_SUBSCRIBERS.delete(label);
        };
    }
    clear() {
        if (typeof window === 'undefined')
            return;
        for (const key of this._GT_MEMORY.keys()) {
            if (key.startsWith('__waiters_'))
                continue;
            delete globalThis[key];
        }
        this._GT_MEMORY.clear();
        this._GT_SUBSCRIBERS.clear();
    }
    _emit(label, value) {
        if (typeof window === 'undefined')
            return;
        const set = this._GT_SUBSCRIBERS.get(label);
        if (!set)
            return;
        for (const cb of set) {
            try {
                cb(value);
            }
            catch (e) {
                console.error('[gt] subscriber threw', label, e);
            }
        }
    }
    _peek(label) {
        if (typeof window === 'undefined')
            return undefined;
        if (this.ttl_active)
            this.touchMemory();
        if (!label)
            return undefined;
        return globalThis[label];
    }
    async getAsync(label) {
        if (typeof window === 'undefined')
            return undefined;
        if (this.ttl_active)
            this.touchMemory();
        if (!label)
            return undefined;
        const existing = this._peek(label);
        if (existing !== undefined)
            return existing;
        return this.waitFor(label);
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
            let waiters = this._GT_MEMORY.get(waiterKey);
            if (!waiters) {
                waiters = new Set();
                this._GT_MEMORY.set(waiterKey, waiters);
            }
            waiters.add(resolve);
        });
    }
}
export const gt = new GT();
