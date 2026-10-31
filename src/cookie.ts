export class COOKIE {
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

    protected memory = new Map<S, unknown>()
    public _channel?: BroadcastChannel
    public _localChange = false
    private subscribers = new Map<string, Set<(value: any) => void>>()

    constructor() {
        if (typeof BroadcastChannel !== 'undefined') {
            this._channel = new BroadcastChannel('sauron_storage_sync')
            this._channel.onmessage = (e) => {
                if (this._localChange) {
                    this._localChange = false
                    return
                }

                const { key, value, storageType, fn, path, domain, options } = e.data
                if (storageType !== 'cookie') return

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
            return navigator.locks.request('cookie_write_' + key, fn) as Promise<T>
        }
        return fn()
    }

    // #region ███ COOKIES ██████████████████████████████████████████████████████
    private getCookieRaw(key: string): string | null {
        if (typeof document === 'undefined') return null
        const cookies = document.cookie.split(';')
        for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=')
            if (name === key) return decodeURIComponent(value ?? '')
        }
        return null
    }
    private setCookieRaw(
        key: string,
        value: string,
        options?: {
            maxAge?: number
            path?: string
            domain?: string
            secure?: boolean
            httpOnly?: boolean
            sameSite?: 'strict' | 'lax' | 'none'
        }
    ): void {
        if (typeof document === 'undefined') return

        let cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}`

        if (options?.maxAge !== undefined) cookie += `; Max-Age=${options.maxAge}`
        if (options?.path) cookie += `; Path=${options.path}`
        if (options?.domain) cookie += `; Domain=${options.domain}`
        if (options?.secure) cookie += '; Secure'
        if (options?.httpOnly) cookie += '; HttpOnly'
        if (options?.sameSite) cookie += `; SameSite=${options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1)}`

        document.cookie = cookie
    }

    public get(key: string) {
        if (typeof window === 'undefined') return null
        if (this.ttl_active) this.touchMemory()
        if (!key) return null
        if (this.memory.has(key)) { return this.deser(this.memory.get(key) as string) }
        const raw = this.getCookieRaw(key)
        const v = this.deser(raw)
        if (raw !== null) this.memory.set(key, raw)
        return v
    }
    public async getMany(keys: string[]): Promise<Record<string, any>> {
        if (typeof window === 'undefined') return {}
        if (this.ttl_active) this.touchMemory()
        const result: Record<string, any> = {}
        for (const key of keys) { result[key] = await this.get(key) }
        return result
    }
    public async set(key: string, value: any, options?: { maxAge?: number; path?: string; domain?: string; secure?: boolean; httpOnly?: boolean; sameSite?: 'strict' | 'lax' | 'none' }) {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory()
        if (!key) return

        const wk = `__waiters_${key}`
        const ws = this.memory.get(wk) as Set<(value: unknown) => void> | undefined
        if (ws) { for (const resolve of ws) resolve(value); this.memory.delete(wk) }

        const serialized = this.ser(value)
        await this._withLock(key, () => {
            this.setCookieRaw(key, serialized, options)
            this.memory.set(key, serialized)
        })
        this._broadcast(key, serialized, 'cookie', 'set', undefined, undefined, options)
        this._emit(key, this.deser(serialized))
    }
    public async update(key: string, value: any, options?: { maxAge?: number; path?: string; domain?: string; secure?: boolean; httpOnly?: boolean; sameSite?: 'strict' | 'lax' | 'none' }) {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory()
        if (!key) return
        if (!this.has(key)) return

        const wk = `__waiters_${key}`
        const ws = this.memory.get(wk) as Set<(value: unknown) => void> | undefined
        if (ws) { for (const resolve of ws) resolve(value); this.memory.delete(wk) }

        const serialized = this.ser(value)
        await this._withLock(key, () => {
            if (this.getCookieRaw(key) !== null) {
                this.setCookieRaw(key, serialized, options)
                this.memory.set(key, serialized)
            }
        })
        this._broadcast(key, serialized, 'cookie', 'set', undefined, undefined, options)
        this._emit(key, this.deser(serialized))
    }
    public async setMany(entries: Record<string, any>, options?: { maxAge?: number; path?: string; domain?: string; secure?: boolean; httpOnly?: boolean; sameSite?: 'strict' | 'lax' | 'none' }): Promise<void> {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory()
        for (const [key, value] of Object.entries(entries)) {
            await this.set(key, value, options)
        }
    }
    public async delete(key: string, path?: string, domain?: string) {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory()
        if (!key) return
        await this._withLock(key, () => {
            this.setCookieRaw(key, '', { maxAge: 0, path: path || '/', domain })
            this.memory.delete(key)
        })
        this._broadcast(key, '', 'cookie', 'delete', path, domain)
        this._emit(key, undefined)
    }
    public async deleteMany(keys: string[]) {
        if (typeof window === 'undefined') return
        if (this.ttl_active) this.touchMemory()
        for (const k of keys) { await this.delete(k) }
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
        for (const key of this.memory.keys()) {
            if (key.startsWith('__waiters_')) continue
            this.setCookieRaw(key, '', { maxAge: 0, path: '/' })
        }
        this.memory.clear()
        this.subscribers.clear()
    }
    public has(key: string): boolean {
        if (typeof window === 'undefined') return false
        if (!key) return false
        if (this.memory.has(key)) return true
        return this.getCookieRaw(key) !== null
    }
    private _emit(key: string, value: any) {
        if (typeof window === 'undefined') return
        const set = this.subscribers.get(key)
        if (!set) return
        for (const cb of set) {
            try { cb(value) } catch (e) { console.error('[cookie] subscriber threw', key, e) }
        }
    }
    private _peek(key: string): any {
        if (typeof window === 'undefined') return undefined
        if (this.ttl_active) this.touchMemory()
        if (!key) return undefined
        if (this.memory.has(key)) { return this.deser(this.memory.get(key) as string) }
        return this.deser(this.getCookieRaw(key))
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

export const cookie = new COOKIE()
