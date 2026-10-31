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
    MAX_PENDING = 4096;
    sentTimestamps;
    pendingResolvers;
    cursor = 0;
    counter;
    epoch = 0;
    id() {
        const g = globalThis;
        const c = g._sauronIdCounter ?? (g._sauronIdCounter = new Uint32Array(1));
        if (++c[0] === 0)
            this.epoch++;
        g._sauronIdCounter = c;
        return `${this.epoch}:${c[0]}`;
    }
    _sid() {
        return this.id();
    }
    constructor() {
        this.counter = new Uint32Array(1);
        this.sentTimestamps = new Float64Array(this.MAX_PENDING);
        this.pendingResolvers = new Array(this.MAX_PENDING);
    }
}
export const _bid = new BYTE_ID();
// #endregion
//                                                                                               [STORE]
// #region ══════════════════════════════════════════════════════════════════════════════════════════════════════
export const ROOT_REG = '__ROOT_REG__';
export const MASTER_REG = '__MASTER_REG__';
export const SLAVE_REG = '__SLAVE_REG__';
export function getNestedStoreMap(sl_reg = SLAVE_REG, ms_reg = MASTER_REG, globalKey = ROOT_REG) {
    let root = globalThis[globalKey];
    if (!root) {
        root = new Map();
        ;
        globalThis[globalKey] = root;
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
export const store = {
    get(key, opts = {}) {
        const { sl_reg, ms_reg, globalKey } = opts;
        const _state = getNestedStoreMap(sl_reg, ms_reg, globalKey);
        const _persistent = getNestedStoreMap(sl_reg ? `${sl_reg}_PERSISTENT` : undefined, ms_reg, globalKey);
        const _persistKeys = getNestedStoreMap(sl_reg ? `${sl_reg}_PERSIST_KEYS` : undefined, ms_reg, globalKey);
        if (_state.has(key))
            return _state.get(key);
        if (_persistKeys.has(key) && _persistent.has(key)) {
            const v = _persistent.get(key);
            _state.set(key, v);
            return v;
        }
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
export function getScopedStateMetadata(sl_reg = SLAVE_REG, ms_reg = MASTER_REG, globalKey = ROOT_REG) {
    let root = globalThis[globalKey];
    if (!root) {
        root = new Map();
        globalThis[globalKey] = root;
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
            _globalListeners: new Set()
        };
        masterMap.set(`${sl_reg}_META`, metaMap);
    }
    return metaMap;
}
export const state = {
    get(key, opts = {}) { return store.get(key, opts); },
    set(key, value, opts = {}) {
        const { sl_reg, ms_reg, globalKey, triggerRender = true } = opts;
        const meta = getScopedStateMetadata(sl_reg, ms_reg, globalKey);
        if (meta._batches.has(key)) {
            const prev = store.get(key, opts);
            const next = typeof value === 'function' ? value(prev) : value;
            meta._batchQueue.set(key, next);
            meta._batchOpts.set(key, { triggerRender });
            return;
        }
        store.set(key, value, { triggerRender, sl_reg, ms_reg, globalKey });
        // Broadcast to scoped global subscribers
        const finalVal = store.get(key, opts);
        for (const listener of meta._globalListeners) {
            try {
                listener(key, finalVal);
            }
            catch (err) {
                console.error(`[Sauron Global Listener Error]:`, err);
            }
        }
    },
    delete(key, opts = {}) {
        const { sl_reg, ms_reg, globalKey } = opts;
        const meta = getScopedStateMetadata(sl_reg, ms_reg, globalKey);
        meta._batchQueue.delete(key);
        meta._batchOpts.delete(key);
        const deleted = store.delete(key, opts);
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
        return store.entries(opts)
            .filter(([key]) => typeof key === 'string' && key.startsWith(prefix))
            .map(([key, value]) => ({ key: key, value }));
    },
    getAll(opts = {}) {
        const result = {};
        for (const [key, value] of store.entries(opts)) {
            result[key] = value;
        }
        return result;
    },
    subscribe(key, listener, opts = {}) {
        return store.subscribe(key, listener, opts);
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
                store.set(key, value, { ...batchOpts, sl_reg, ms_reg, globalKey });
            }
        }
        finally {
            meta._batches.delete(key);
        }
    },
    clear(opts = {}) {
        const { sl_reg, ms_reg, globalKey } = opts;
        const meta = getScopedStateMetadata(sl_reg, ms_reg, globalKey);
        store.clear(opts);
        meta._batches.clear();
        meta._batchQueue.clear();
        meta._batchOpts.clear();
        meta._globalListeners.clear();
    }
};
export default state;
export function publish(key, value, opts) { state.set(key, value, opts); }
export function subscribe(key, listener, opts) { return state.subscribe(key, listener, opts); }
export function getAll(opts) { return state.getAll(opts); }
export function set(label, value, triggerRender = true, sl_reg, ms_reg, globalKey) {
    if (!label)
        return;
    state.set(label, value, { triggerRender, sl_reg, ms_reg, globalKey });
}
export function get(label, sl_reg, ms_reg, globalKey) {
    if (!label)
        return undefined;
    return state.get(label, { sl_reg, ms_reg, globalKey });
}
export function sub(label, fn, sl_reg, ms_reg, globalKey) {
    if (!label || !fn)
        return () => { };
    return state.subscribe(label, fn, { sl_reg, ms_reg, globalKey });
}
export function del(label, sl_reg, ms_reg, globalKey) {
    if (!label)
        return false;
    return state.delete(label, { sl_reg, ms_reg, globalKey });
}
export function subAll(fn, sl_reg, ms_reg, globalKey) {
    if (!fn)
        return () => { };
    return state.subscribeAll(fn, { sl_reg, ms_reg, globalKey });
}
// #endregion
