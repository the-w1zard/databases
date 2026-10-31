//                                                                                          [REGISTRIES]
// #region ══════════════════════════════════════════════════════════════════════════════════════════════════════
import { _bid, state } from "./state.js";
const REGISTRIES = globalThis.__sauron_scoped_registries ?? (globalThis.__sauron_scoped_registries = {});
export function createRegistry(name = _bid.id()) {
    if (REGISTRIES[name])
        return REGISTRIES[name];
    // Completely isolated store + infra
    const _state = new Map();
    const _listeners = new Map();
    const _globalListeners = new Set();
    const _batches = new Set();
    const _batchQueue = new Map();
    const _batchOpts = new Map();
    const api = {
        name,
        get(key) {
            return _state.get(key);
        },
        set(key, value, opts = {}) {
            if (_batches.has(key)) {
                const prev = _state.get(key);
                const next = typeof value === 'function' ? value(prev) : value;
                _batchQueue.set(key, next);
                _batchOpts.set(key, opts);
                return;
            }
            const prev = _state.get(key);
            const next = typeof value === 'function' ? value(prev) : value;
            if (Object.is(prev, next))
                return;
            _state.set(key, next);
            // key listeners
            const ls = _listeners.get(key);
            if (ls)
                for (const fn of ls)
                    fn(next);
            // global listeners
            for (const fn of _globalListeners)
                fn(key, next);
        },
        delete(key) {
            _batchQueue.delete(key);
            _batchOpts.delete(key);
            const existed = _state.delete(key);
            if (!existed)
                return false;
            for (const fn of _globalListeners)
                fn(key, undefined);
            return true;
        },
        getByPrefix(prefix) {
            const out = [];
            for (const [k, v] of _state.entries()) {
                if (typeof k === 'string' && k.startsWith(prefix)) {
                    out.push({ key: k, value: v });
                }
            }
            return out;
        },
        getAll() {
            const out = {};
            for (const [k, v] of _state.entries())
                out[k] = v;
            return out;
        },
        subscribe(key, listener) {
            if (!_listeners.has(key))
                _listeners.set(key, new Set());
            _listeners.get(key).add(listener);
            return () => _listeners.get(key).delete(listener);
        },
        subscribeAll(listener) {
            _globalListeners.add(listener);
            return () => _globalListeners.delete(listener);
        },
        batch(key, fn) {
            _batches.add(key);
            try {
                fn();
                if (_batchQueue.has(key)) {
                    const value = _batchQueue.get(key);
                    const opts = _batchOpts.get(key) ?? {};
                    _batchQueue.delete(key);
                    _batchOpts.delete(key);
                    api.set(key, value, opts);
                }
            }
            finally {
                _batches.delete(key);
            }
        },
        clear() {
            _state.clear();
            _listeners.clear();
            _globalListeners.clear();
            _batches.clear();
            _batchQueue.clear();
            _batchOpts.clear();
        },
        destroy() {
            api.clear();
            delete REGISTRIES[name];
        }
    };
    REGISTRIES[name] = api;
    return api;
}
export function getRegistry(name) { return REGISTRIES[name]; }
export function getAllRegistries() { return REGISTRIES; }
export function getGR(label, registry) {
    if (!label)
        return undefined;
    return state.get(label);
}
// #endregion
