export const ROOT_REG = '__THE_WIZARD_REG__';
export const MASTER_REG = '__SAURON__';
export const SLAVE_REG = '__STATE__';
export class SESSION {
    ttl_active = false;
    ttl_minutes = 30;
    memoryTimer;
    touchMemory() {
        if (this.memoryTimer)
            clearTimeout(this.memoryTimer);
        this.memoryTimer = setTimeout(() => {
            this.memory.clear();
            sessionStorage.clear();
            this.memoryTimer = undefined;
        }, this.ttl_minutes * 60 * 1000);
    }
    memory = new Map();
    _channel;
    _echoId = Math.random().toString(36).slice(2);
    subscribers = new Map();
    constructor() {
        if (typeof BroadcastChannel !== 'undefined') {
            this._channel = new BroadcastChannel('sauron_storage_sync');
            this._channel.onmessage = (e) => {
                if (e.data?.echoId === this._echoId)
                    return;
                const { key, value, storageType, fn } = e.data;
                if (storageType !== 'ss')
                    return;
                if (fn === 'delete') {
                    if (typeof sessionStorage !== 'undefined')
                        sessionStorage.removeItem(key);
                    this.memory.delete(key);
                    this._emit(key, undefined);
                }
                else {
                    if (typeof sessionStorage !== 'undefined')
                        sessionStorage.setItem(key, value);
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
        this._channel?.postMessage({ echoId: this._echoId, key, value, storageType, fn, path, domain, options });
    }
    async _withLock(key, fn) {
        if (typeof navigator !== 'undefined' && navigator.locks) {
            return navigator.locks.request('ss_write_' + key, fn);
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
        const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null;
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
            sessionStorage.setItem(key, serialized);
            this.memory.set(key, serialized);
        });
        this._broadcast(key, serialized, 'ss', 'set');
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
        let wrote = false;
        await this._withLock(key, () => {
            if (sessionStorage.getItem(key) !== null) {
                sessionStorage.setItem(key, serialized);
                this.memory.set(key, serialized);
                wrote = true;
            }
        });
        if (!wrote)
            return;
        if (ws) {
            for (const resolve of ws)
                resolve(value);
            this.memory.delete(wk);
        }
        this._broadcast(key, serialized, 'ss', 'set');
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
            if (typeof sessionStorage !== 'undefined')
                sessionStorage.removeItem(key);
            this.memory.delete(key);
        });
        this._broadcast(key, '', 'ss', 'delete');
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
        if (typeof sessionStorage !== 'undefined') {
            const root = sessionStorage.getItem(ROOT_REG);
            sessionStorage.clear();
            if (root !== null)
                sessionStorage.setItem(ROOT_REG, root);
        }
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
                console.error('[ss] subscriber threw', key, e);
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
        const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null;
        return this.deser(raw);
    }
    has(key) {
        if (typeof window === 'undefined')
            return false;
        if (this.memory.has(key))
            return true;
        if (typeof sessionStorage === 'undefined')
            return false;
        return sessionStorage.getItem(key) !== null;
    }
    waitFor(key, timeoutMs = 30_000) {
        if (typeof window === 'undefined')
            return new Promise(() => { });
        if (this.ttl_active)
            this.touchMemory();
        const existing = this._peek(key);
        if (existing !== undefined)
            return Promise.resolve(existing);
        return new Promise((resolve, reject) => {
            const waiterKey = `__waiters_${key}`;
            const waiters = this.memory.get(waiterKey) ?? new Set();
            this.memory.set(waiterKey, waiters);
            const timer = setTimeout(() => {
                waiters.delete(wrapped);
                if (waiters.size === 0)
                    this.memory.delete(waiterKey);
                reject(new Error(`[ss] waitFor timeout: ${key}`));
            }, timeoutMs);
            const wrapped = (v) => { clearTimeout(timer); resolve(v); };
            waiters.add(wrapped);
        });
    }
}
export const session = new SESSION();
export function getNestedStoreMap(sl_reg = SLAVE_REG, ms_reg = MASTER_REG, globalKey = ROOT_REG) {
    let root = session.get(globalKey);
    if (!root) {
        root = new Map();
        session.set(globalKey, root);
    }
    let masterMap = root.get(ms_reg);
    if (!masterMap) {
        masterMap = new Map();
        root.set(ms_reg, masterMap);
    }
    let slaveMap = masterMap.get(sl_reg);
    if (!slaveMap) {
        slaveMap = new Map();
        masterMap.set(sl_reg, slaveMap);
    }
    return slaveMap;
}
export const session_store = {
    get(key, opts = {}) {
        const { sl_reg, ms_reg, globalKey } = opts;
        const _state = getNestedStoreMap(sl_reg, ms_reg, globalKey);
        if (_state.has(key))
            return _state.get(key);
        const _persistent = getNestedStoreMap(sl_reg ? `${sl_reg}_PERSISTENT` : undefined, ms_reg, globalKey);
        const _persistKeys = getNestedStoreMap(sl_reg ? `${sl_reg}_PERSIST_KEYS` : undefined, ms_reg, globalKey);
        if (_persistKeys.has(key) && _persistent.has(key))
            return _persistent.get(key);
        return undefined;
    },
    set(key, value, opts = { triggerRender: true }) {
        const { triggerRender = true, sl_reg, ms_reg, globalKey } = opts;
        const _state = getNestedStoreMap(sl_reg, ms_reg, globalKey);
        const _persistent = getNestedStoreMap(sl_reg ? `${sl_reg}_PERSISTENT` : undefined, ms_reg, globalKey);
        const _persistKeys = getNestedStoreMap(sl_reg ? `${sl_reg}_PERSIST_KEYS` : undefined, ms_reg, globalKey);
        const _listeners = getNestedStoreMap(sl_reg ? `${sl_reg}_LISTENERS` : undefined, ms_reg, globalKey);
        const prev = _state.get(key);
        const next = typeof value === 'function' ? value(prev) : value;
        if (Object.is(prev, next))
            return;
        _state.set(key, next);
        if (_persistKeys.has(key))
            _persistent.set(key, next);
        if (triggerRender)
            _listeners.get(key)?.forEach(l => l(next));
    },
    subscribe(key, listener, opts = {}) {
        const { sl_reg, ms_reg, globalKey } = opts;
        const _listeners = getNestedStoreMap(sl_reg ? `${sl_reg}_LISTENERS` : undefined, ms_reg, globalKey);
        if (!_listeners.has(key))
            _listeners.set(key, new Set());
        _listeners.get(key).add(listener);
        return () => {
            _listeners.get(key)?.delete(listener);
            if (_listeners.get(key)?.size === 0)
                _listeners.delete(key);
        };
    },
    delete(key, opts = {}) {
        const { sl_reg, ms_reg, globalKey } = opts;
        const _state = getNestedStoreMap(sl_reg, ms_reg, globalKey);
        const _persistent = getNestedStoreMap(sl_reg ? `${sl_reg}_PERSISTENT` : undefined, ms_reg, globalKey);
        const _persistKeys = getNestedStoreMap(sl_reg ? `${sl_reg}_PERSIST_KEYS` : undefined, ms_reg, globalKey);
        const _listeners = getNestedStoreMap(sl_reg ? `${sl_reg}_LISTENERS` : undefined, ms_reg, globalKey);
        const existed = _state.delete(key);
        if (_persistKeys.has(key)) {
            _persistKeys.delete(key);
            _persistent.delete(key);
        }
        _listeners.get(key)?.forEach(l => l(undefined));
        _listeners.delete(key);
        return existed;
    },
    entries(opts = {}) {
        const { sl_reg, ms_reg, globalKey } = opts;
        const _state = getNestedStoreMap(sl_reg, ms_reg, globalKey);
        return Array.from(_state.entries());
    },
    persist(key, opts = {}) {
        const { sl_reg, ms_reg, globalKey } = opts;
        const _persistKeys = getNestedStoreMap(// Map, not Set
        sl_reg ? `${sl_reg}_PERSIST_KEYS` : undefined, ms_reg, globalKey);
        _persistKeys.set(key, true);
    },
    unpersist(key, opts = {}) {
        const { sl_reg, ms_reg, globalKey } = opts;
        const _persistent = getNestedStoreMap(sl_reg ? `${sl_reg}_PERSISTENT` : undefined, ms_reg, globalKey);
        const _persistKeys = getNestedStoreMap(sl_reg ? `${sl_reg}_PERSIST_KEYS` : undefined, ms_reg, globalKey);
        _persistKeys.delete(key);
        _persistent.delete(key);
    },
    has(key, opts = {}) {
        const { sl_reg, ms_reg, globalKey } = opts;
        const _state = getNestedStoreMap(sl_reg, ms_reg, globalKey);
        const _persistent = getNestedStoreMap(sl_reg ? `${sl_reg}_PERSISTENT` : undefined, ms_reg, globalKey);
        const _persistKeys = getNestedStoreMap(sl_reg ? `${sl_reg}_PERSIST_KEYS` : undefined, ms_reg, globalKey);
        return _state.has(key) || (_persistKeys.has(key) && _persistent.has(key));
    },
    clear(opts = {}) {
        const { sl_reg, ms_reg, globalKey } = opts;
        const _state = getNestedStoreMap(sl_reg, ms_reg, globalKey);
        const _listeners = getNestedStoreMap(sl_reg ? `${sl_reg}_LISTENERS` : undefined, ms_reg, globalKey);
        _state.clear();
        _listeners.clear();
    },
    clearPersistent(opts = {}) {
        const { sl_reg, ms_reg, globalKey } = opts;
        const _persistent = getNestedStoreMap(sl_reg ? `${sl_reg}_PERSISTENT` : undefined, ms_reg, globalKey);
        const _persistKeys = getNestedStoreMap(sl_reg ? `${sl_reg}_PERSIST_KEYS` : undefined, ms_reg, globalKey);
        _persistent.clear();
        _persistKeys.clear();
    }
};
// #endregion
// #region ████████████████████████████████████ STATE █████████████████████████████████████████
export function getScopedStateMetadata(sl_reg = SLAVE_REG, ms_reg = MASTER_REG, globalKey = ROOT_REG) {
    let root = session.get(globalKey);
    if (!root) {
        root = new Map();
        session.set(globalKey, root);
    }
    let masterMap = root.get(ms_reg);
    if (!masterMap) {
        masterMap = new Map();
        root.set(ms_reg, masterMap);
    }
    let metaMap = masterMap.get(`${sl_reg}_META`);
    if (!metaMap) {
        metaMap = {
            _batches: new Set(),
            _batchQueue: new Map(),
            _batchOpts: new Map(),
            _globalListeners: new Set(),
            _waiters: new Map()
        };
        masterMap.set(`${sl_reg}_META`, metaMap);
    }
    return metaMap;
}
export const session_state = {
    get(key, opts = {}) { return session_store.get(key, opts); },
    set(key, value, opts = {}) {
        const { sl_reg, ms_reg, globalKey, triggerRender = true } = opts;
        const meta = getScopedStateMetadata(sl_reg, ms_reg, globalKey);
        if (meta._batches.has(key)) {
            const prev = session_store.get(key, opts);
            const next = typeof value === 'function' ? value(prev) : value;
            meta._batchQueue.set(key, next);
            meta._batchOpts.set(key, { triggerRender });
            return;
        }
        session_store.set(key, value, { triggerRender, sl_reg, ms_reg, globalKey });
        if (triggerRender) {
            const finalVal = session_store.get(key, opts);
            for (const listener of meta._globalListeners) {
                try {
                    listener(key, finalVal);
                }
                catch (err) {
                    console.error(`[Sauron Global Listener Error]:`, err);
                }
            }
        }
    },
    delete(key, opts = {}) {
        const { sl_reg, ms_reg, globalKey } = opts;
        const meta = getScopedStateMetadata(sl_reg, ms_reg, globalKey);
        meta._batchQueue.delete(key);
        meta._batchOpts.delete(key);
        const deleted = session_store.delete(key, opts);
        if (deleted) {
            for (const listener of meta._globalListeners) {
                try {
                    listener(key, undefined);
                }
                catch (err) {
                    console.error(`[Sauron Global Listener Error]:`, err);
                }
            }
        }
        return deleted;
    },
    getByPrefix(prefix, opts = {}) {
        return session_store.entries(opts)
            .filter(([key]) => typeof key === 'string' && key.startsWith(prefix))
            .map(([key, value]) => ({ key: key, value }));
    },
    getAll(opts = {}) {
        const result = {};
        for (const [key, value] of session_store.entries(opts)) {
            result[key] = value;
        }
        return result;
    },
    subscribe(key, listener, opts = {}) {
        return session_store.subscribe(key, listener, opts);
    },
    subscribeAll(listener, opts = {}) {
        const { sl_reg, ms_reg, globalKey } = opts;
        const meta = getScopedStateMetadata(sl_reg, ms_reg, globalKey);
        meta._globalListeners.add(listener);
        return () => {
            meta._globalListeners.delete(listener);
        };
    },
    batch(key, fn, opts = {}) {
        const { sl_reg, ms_reg, globalKey } = opts;
        const meta = getScopedStateMetadata(sl_reg, ms_reg, globalKey);
        meta._batches.add(key);
        try {
            fn();
            if (meta._batchQueue.has(key)) {
                const value = meta._batchQueue.get(key);
                const batchOpts = meta._batchOpts.get(key) ?? {};
                meta._batchQueue.delete(key);
                meta._batchOpts.delete(key);
                session_store.set(key, value, { ...batchOpts, sl_reg, ms_reg, globalKey });
            }
        }
        finally {
            meta._batches.delete(key);
        }
    },
    clear(opts = {}) {
        const { sl_reg, ms_reg, globalKey } = opts;
        const meta = getScopedStateMetadata(sl_reg, ms_reg, globalKey);
        session_store.clear(opts);
        meta._batches.clear();
        meta._batchQueue.clear();
        meta._batchOpts.clear();
        meta._globalListeners.clear();
    }
};
export function publishSSC(key, value, opts) { session_state.set(key, value, opts); }
export function subscribeSSC(key, listener, opts) { return session_state.subscribe(key, listener, opts); }
export function getAllSSC(opts) { return session_state.getAll(opts); }
export function setSSC(label, value, triggerRender = true, sl_reg, ms_reg, globalKey) {
    if (!label)
        return;
    session_state.set(label, value, { triggerRender, sl_reg, ms_reg, globalKey });
}
export function getSSC(label, sl_reg, ms_reg, globalKey) {
    if (!label)
        return undefined;
    return session_state.get(label, { sl_reg, ms_reg, globalKey });
}
export function subSSC(label, fn, sl_reg, ms_reg, globalKey) {
    if (!label || !fn)
        return () => { };
    return session_state.subscribe(label, fn, { sl_reg, ms_reg, globalKey });
}
export function deleteSSC(label, sl_reg, ms_reg, globalKey) {
    if (!label)
        return false;
    return session_state.delete(label, { sl_reg, ms_reg, globalKey });
}
export function subAllSSC(fn, sl_reg, ms_reg, globalKey) {
    if (!fn)
        return () => { };
    return session_state.subscribeAll(fn, { sl_reg, ms_reg, globalKey });
}
