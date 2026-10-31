export class COOKIE {
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
    constructor() {
        if (typeof BroadcastChannel !== 'undefined') {
            this._channel = new BroadcastChannel('sauron_storage_sync');
            this._channel.onmessage = (e) => {
                if (this._localChange) {
                    this._localChange = false;
                    return;
                }
                const { key, value, storageType, fn, path, domain, options } = e.data;
                if (storageType !== 'cookie')
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
            return navigator.locks.request('cookie_write_' + key, fn);
        }
        return fn();
    }
    // #region ███ COOKIES ██████████████████████████████████████████████████████
    getCookieRaw(key) {
        if (typeof document === 'undefined')
            return null;
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === key)
                return decodeURIComponent(value ?? '');
        }
        return null;
    }
    setCookieRaw(key, value, options) {
        if (typeof document === 'undefined')
            return;
        let cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
        if (options?.maxAge !== undefined)
            cookie += `; Max-Age=${options.maxAge}`;
        if (options?.path)
            cookie += `; Path=${options.path}`;
        if (options?.domain)
            cookie += `; Domain=${options.domain}`;
        if (options?.secure)
            cookie += '; Secure';
        if (options?.httpOnly)
            cookie += '; HttpOnly';
        if (options?.sameSite)
            cookie += `; SameSite=${options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1)}`;
        document.cookie = cookie;
    }
    get(key) {
        if (typeof window === 'undefined')
            return null;
        if (this.ttl_active)
            this.touchMemory();
        if (!key)
            return null;
        if (this.memory.has(key)) {
            return this.deser(this.memory.get(key));
        }
        const raw = this.getCookieRaw(key);
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
    async set(key, value, options) {
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
        await this._withLock(key, () => {
            this.setCookieRaw(key, serialized, options);
            this.memory.set(key, serialized);
        });
        this._broadcast(key, serialized, 'cookie', 'set', undefined, undefined, options);
        this._emit(key, this.deser(serialized));
    }
    async update(key, value, options) {
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
        if (ws) {
            for (const resolve of ws)
                resolve(value);
            this.memory.delete(wk);
        }
        const serialized = this.ser(value);
        await this._withLock(key, () => {
            if (this.getCookieRaw(key) !== null) {
                this.setCookieRaw(key, serialized, options);
                this.memory.set(key, serialized);
            }
        });
        this._broadcast(key, serialized, 'cookie', 'set', undefined, undefined, options);
        this._emit(key, this.deser(serialized));
    }
    async setMany(entries, options) {
        if (typeof window === 'undefined')
            return;
        if (this.ttl_active)
            this.touchMemory();
        for (const [key, value] of Object.entries(entries)) {
            await this.set(key, value, options);
        }
    }
    async delete(key, path, domain) {
        if (typeof window === 'undefined')
            return;
        if (this.ttl_active)
            this.touchMemory();
        if (!key)
            return;
        await this._withLock(key, () => {
            this.setCookieRaw(key, '', { maxAge: 0, path: path || '/', domain });
            this.memory.delete(key);
        });
        this._broadcast(key, '', 'cookie', 'delete', path, domain);
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
        for (const key of this.memory.keys()) {
            if (key.startsWith('__waiters_'))
                continue;
            this.setCookieRaw(key, '', { maxAge: 0, path: '/' });
        }
        this.memory.clear();
        this.subscribers.clear();
    }
    has(key) {
        if (typeof window === 'undefined')
            return false;
        if (!key)
            return false;
        if (this.memory.has(key))
            return true;
        return this.getCookieRaw(key) !== null;
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
                console.error('[cookie] subscriber threw', key, e);
            }
        }
    }
    _peek(key) {
        if (typeof window === 'undefined')
            return undefined;
        if (this.ttl_active)
            this.touchMemory();
        if (!key)
            return undefined;
        if (this.memory.has(key)) {
            return this.deser(this.memory.get(key));
        }
        return this.deser(this.getCookieRaw(key));
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
export const cookie = new COOKIE();
