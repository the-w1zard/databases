//                                                                                   [SCOPED REGISTRIES]
// #region ══════════════════════════════════════════════════════════════════════════════════════════════════════
import { _bid } from "./state.js";
export function createScopedReg(name = _bid.id()) {
    // Completely isolated store + infra
    const _state = new Map();
    const _listeners = new Map();
    const _batches = new Set();
    const _batchQueue = new Map();
    const _batchOpts = new Map();
    const _globalListeners = new Set();
    const registry = {
        name,
        get(key) { return _state.get(key); },
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
            // Notify key listeners
            const ls = _listeners.get(key);
            if (ls) {
                for (const fn of ls) {
                    try {
                        fn(next);
                    }
                    catch (err) {
                        console.error(`[Registry ${name} Listener Error]:`, err);
                    }
                }
            }
            // Notify global listeners
            for (const fn of _globalListeners) {
                try {
                    fn(key, next);
                }
                catch (err) {
                    console.error(`[Registry ${name} Global Listener Error]:`, err);
                }
            }
        },
        delete(key) {
            _batchQueue.delete(key);
            _batchOpts.delete(key);
            const existed = _state.delete(key);
            if (existed) {
                for (const fn of _globalListeners) {
                    try {
                        fn(key, undefined);
                    }
                    catch (err) {
                        console.error(`[Registry ${name} Global Listener Error]:`, err);
                    }
                }
            }
            return existed;
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
            return () => {
                const set = _listeners.get(key);
                if (!set)
                    return;
                set.delete(listener);
                if (set.size === 0)
                    _listeners.delete(key);
            };
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
                    registry.set(key, value, opts);
                }
            }
            finally {
                _batches.delete(key);
            }
        },
        clear() {
            _state.clear();
            _listeners.clear();
            _batches.clear();
            _batchQueue.clear();
            _batchOpts.clear();
            _globalListeners.clear();
        },
        destroy() { registry.clear(); }
    };
    return registry;
}
// #endregion
