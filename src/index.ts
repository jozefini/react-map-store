import {
  startTransition,
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'

// Store
export type TFunction = (...args: unknown[]) => unknown
export type TStoreKey<TMap, TMapKey extends keyof TMap> = TMapKey
export type TStoreValue<TMap, TMapKey extends keyof TMap> = TMap[TMapKey]
export type TStorePartial<TMap, TMapKey extends keyof TMap> = Partial<
  TMap[TMapKey]
>

// Constructor
export type TStoreConstructor<TMap> = {
  name?: string // For devtools, if set it will activate the devtools
  initialMap?: Map<keyof TMap, TMap[keyof TMap]>
  fallbackValue?: TMap[keyof TMap]
  devtools?: boolean
  type?: 'map' | 'object'
}

// Nested
type Primitive = string | number | boolean | null | undefined
type PathImpl<T, K extends keyof T> = K extends string
  ? T[K] extends Primitive
    ? [K]
    : T[K] extends Array<infer U>
      ? [K] | [K, number] | [K, number, ...PathImpl<U, keyof U>]
      : [K] | [K, ...PathImpl<T[K], keyof T[K]>]
  : never

type Path<T> = [keyof T] | PathImpl<T, keyof T>
type PathValue<T, P extends Path<T>> = P extends [infer K]
  ? K extends keyof T
    ? T[K]
    : never
  : P extends [infer K, ...infer R]
    ? K extends keyof T
      ? R extends Path<T[K]>
        ? PathValue<T[K], R>
        : never
      : never
    : never

// Devtools
type DevToolsExtension = {
  connect: (options: { name: string }) => DevToolsInstance
}
type DevToolsInstance = {
  init: (state: unknown) => void
  subscribe: (listener: (message: DevToolsMessage) => void) => void
  send: (action: { type: string; payload?: unknown }, state: unknown) => void
}
type DevToolsMessage = {
  type: string
  payload: {
    type: string
  }
  state?: string
}
type WindowWithDevTools = Window & {
  __REDUX_DEVTOOLS_EXTENSION__?: DevToolsExtension
}

// Store
export class CreateStore<TMap> {
  private map = new Map<keyof TMap, TMap[keyof TMap]>()
  private itemSubscribers = new Map<string, Set<() => void>>()
  private sizeSubscribers = new Set<() => void>()
  private keysSubscribers = new Set<() => void>()
  private fallbackValue?: TMap[keyof TMap]
  private devtools: DevToolsInstance | null = null
  private type: 'map' | 'object' = 'map'
  private initialState: Map<keyof TMap, TMap[keyof TMap]>
  private pathCache = new Map<keyof TMap | Path<TMap>, string[]>()
  private nestedFallbackValueCache = new Map<string, any>()
  private itemSubscriberPaths = new Set<string>()
  private devtoolsStateCache = new Map<keyof TMap, TMap[keyof TMap]>()

  // Constructor

  constructor(props?: TStoreConstructor<TMap>) {
    this.map = props?.initialMap || new Map()
    this.fallbackValue = props?.fallbackValue
    this.initialState = new Map(this.map)
    this.type = props?.type || 'map'

    if (props?.name && (props.devtools ?? true)) {
      this.initDevtools(props.name)

      if (this.devtools) {
        this.devtools.subscribe(this.handleDevToolsMessage)
      }
    }
  }

  // Helpers

  private addSubscriber(path: Path<TMap>, callback: () => void) {
    const pathString = this.pathToString(path)
    if (!this.itemSubscribers.has(pathString)) {
      this.itemSubscribers.set(pathString, new Set())
      this.itemSubscriberPaths.add(pathString)
    }
    this.itemSubscribers.get(pathString)!.add(callback)
  }

  private removeSubscriber(path: Path<TMap>, callback: () => void) {
    const pathString = this.pathToString(path)
    const subscribers = this.itemSubscribers.get(pathString)
    if (subscribers) {
      subscribers.delete(callback)
      if (subscribers.size === 0) {
        this.itemSubscribers.delete(pathString)
        this.itemSubscriberPaths.delete(pathString)
      }
    }
  }

  private pathToString(path: keyof TMap | Path<TMap>): string {
    if (Array.isArray(path)) {
      let result = ''
      for (let i = 0; i < path.length; i++) {
        if (i > 0) result += '.'
        result += String(path[i])
      }
      return result
    }
    return String(path)
  }

  private pathToStringArray(path: keyof TMap | Path<TMap>): string[] {
    const cached = this.pathCache.get(path)
    if (cached) return cached

    let result: string[]
    if (Array.isArray(path)) {
      const length = path.length
      result = new Array(length)
      for (let i = 0; i < length; i++) {
        result[i] = String(path[i])
      }
    } else {
      result = [String(path)]
    }

    this.pathCache.set(path, result)
    return result
  }

  private getFallbackValue<K extends keyof TMap>(key: K): TMap[K] {
    if (this.type === 'object' && this.fallbackValue) {
      return (this.fallbackValue as any)[key] ?? (this.fallbackValue as TMap[K])
    }
    return this.fallbackValue as TMap[K]
  }

  private getNestedFallbackValue<P extends Path<TMap>>(
    path: P
  ): PathValue<TMap, P> {
    const pathString = this.pathToString(path)
    if (this.nestedFallbackValueCache.has(pathString)) {
      return this.nestedFallbackValueCache.get(pathString)
    }

    if (this.type !== 'object' || !this.fallbackValue) {
      return undefined as PathValue<TMap, P>
    }

    let fallbackValue: any = this.fallbackValue

    // Start from index 1 to skip the top-level key (e.g., 'user')
    for (let i = 1; i < path.length; i++) {
      if (fallbackValue === undefined || fallbackValue === null) {
        return undefined as PathValue<TMap, P>
      }

      if (Array.isArray(fallbackValue) && typeof path[i] === 'number') {
        fallbackValue = fallbackValue[path[i] as number]
      } else {
        fallbackValue = fallbackValue[path[i] as keyof typeof fallbackValue]
      }
    }

    const result =
      fallbackValue !== undefined
        ? fallbackValue
        : (undefined as PathValue<TMap, P>)
    this.nestedFallbackValueCache.set(pathString, result)
    return result
  }

  // Devtools

  private initDevtools(name: string) {
    const extension =
      typeof window !== 'undefined' &&
      (window as WindowWithDevTools).__REDUX_DEVTOOLS_EXTENSION__
    if (extension) {
      this.devtools = extension.connect({
        name,
      })
      this.devtools.init(this.getMap())
    }
  }

  private sendToDevtools(action: string, args?: unknown, skip = false) {
    if (skip || !this.devtools) {
      return
    }

    this.devtoolsStateCache.clear()
    for (const [key, value] of this.getMap()) {
      this.devtoolsStateCache.set(key, value)
    }

    this.devtools.send({ type: action, payload: args }, this.devtoolsStateCache)
  }

  private handleDevToolsMessage = (message: DevToolsMessage) => {
    if (message.type === 'DISPATCH') {
      switch (message.payload.type) {
        case 'RESET':
          this.setMap(new Map(this.initialState), true, true)
          break
        case 'COMMIT':
          this.devtools?.init(Object.fromEntries(this.getMap()))
          break
        case 'ROLLBACK':
        case 'JUMP_TO_STATE':
        case 'JUMP_TO_ACTION':
          if (message.state) {
            try {
              const newState = JSON.parse(message.state)
              this.setMapFromObject(newState, false)
              this.syncMap()
            } catch (error) {
              console.error('Failed to parse state from DevTools:', error)
            }
          }
          break
      }
    }
  }

  private setMapFromObject(obj: Record<string, unknown>, notify = true) {
    const newMap = new Map<keyof TMap, TMap[keyof TMap]>()
    for (const [key, value] of Object.entries(obj)) {
      newMap.set(key as keyof TMap, value as TMap[keyof TMap])
    }
    this.setMap(newMap, notify, true)
  }

  // Sync

  private batchedUpdate(callbacks: Set<() => void>) {
    if (callbacks.size > 0) {
      startTransition(() => {
        for (const callback of callbacks) {
          callback()
        }
      })
    }
  }

  public syncKeys = () => {
    this.batchedUpdate(this.keysSubscribers)
  }

  public syncSize = () => {
    this.batchedUpdate(this.sizeSubscribers)
  }

  public syncItem = (key: keyof TMap | Path<TMap>) => {
    const fullPath = this.pathToString(key)
    const batch = new Set<() => void>()

    for (const subPath of this.itemSubscriberPaths) {
      if (subPath === fullPath || subPath.startsWith(fullPath + '.')) {
        const callbacks = this.itemSubscribers.get(subPath)
        if (callbacks) {
          for (const callback of callbacks) {
            batch.add(callback)
          }
        }
      }
    }

    const pathArray = this.pathToStringArray(key)
    let currentPath = ''
    for (const segment of pathArray) {
      currentPath += (currentPath ? '.' : '') + segment
      const parentCallbacks = this.itemSubscribers.get(currentPath)
      if (parentCallbacks) {
        for (const callback of parentCallbacks) {
          batch.add(callback)
        }
      }
    }

    this.batchedUpdate(batch)
  }

  public syncItems = (keys: (keyof TMap | Path<TMap>)[]) => {
    const batch = new Set<() => void>()

    for (const key of keys) {
      const pathString = this.pathToString(key)
      for (const subPath of this.itemSubscriberPaths) {
        if (subPath === pathString || subPath.startsWith(pathString + '.')) {
          const callbacks = this.itemSubscribers.get(subPath)
          if (callbacks) {
            for (const callback of callbacks) {
              batch.add(callback)
            }
          }
        }
      }
    }

    this.batchedUpdate(batch)
  }

  public syncMap = () => {
    const batch = new Set<() => void>()
    for (const subscribers of this.itemSubscribers.values()) {
      for (const callback of subscribers) {
        batch.add(callback)
      }
    }
    this.batchedUpdate(batch)
  }

  // Getters

  public getMap = () => {
    return this.map as Map<keyof TMap, TMap[keyof TMap]>
  }

  public get<K extends keyof TMap | Path<TMap>>(
    key: K
  ): K extends keyof TMap
    ? TMap[K]
    : K extends Path<TMap>
      ? PathValue<TMap, K>
      : never {
    if (Array.isArray(key)) {
      return this.getScoped(key as Path<TMap>) as any
    }
    return (
      this.map.get(key as keyof TMap) ??
      (this.getFallbackValue(key as keyof TMap) as any)
    )
  }

  private getScoped<P extends Path<TMap>>(path: P): PathValue<TMap, P> {
    let value: any = this.map.get(path[0] as keyof TMap)

    if (value === undefined) {
      return this.getNestedFallbackValue(path)
    }

    for (let i = 1; i < path.length; i++) {
      if (value === undefined || value === null) {
        return this.getNestedFallbackValue(path)
      }
      value = value[path[i] as keyof typeof value]
    }

    return value !== undefined ? value : this.getNestedFallbackValue(path)
  }

  public getSize = () => {
    return this.map.size as number
  }

  public getKeys = (filter?: (_: TMap[keyof TMap], i: number) => boolean) => {
    if (!filter) {
      return Array.from(this.map.keys()) as (keyof TMap)[]
    }
    const keys: (keyof TMap)[] = []
    let i = 0
    for (const [key, value] of this.map) {
      if (filter(value, i++)) {
        keys.push(key)
      }
    }
    return keys
  }

  // Actions

  public set = <P extends keyof TMap | Path<TMap>>(
    path: P,
    item: P extends keyof TMap
      ? TMap[P]
      : P extends Path<TMap>
        ? PathValue<TMap, P>
        : never,
    notify = true
  ) => {
    const pathArray = Array.isArray(path) ? path : [path]
    const topLevelKey = pathArray[0] as keyof TMap

    if (pathArray.length === 1) {
      // Setting a top-level property
      this.map.set(topLevelKey, item as TMap[keyof TMap])
    } else {
      // Setting a nested property
      const existingData = this.map.get(topLevelKey)
      if (existingData === undefined) {
        return // Path doesn't exist, abort set
      }

      let current: any = existingData
      for (let i = 1; i < pathArray.length - 1; i++) {
        if (current[pathArray[i]] === undefined) {
          current[pathArray[i]] = {}
        }
        current = current[pathArray[i]]
      }

      current[pathArray[pathArray.length - 1]] = item
      this.map.set(topLevelKey, existingData)
    }

    this.sendToDevtools('SET', { path, item })

    if (notify) {
      startTransition(() => {
        this.syncItem(path)
        if (pathArray.length === 1) {
          // Only sync size and keys if it's a top-level change
          this.syncSize()
          this.syncKeys()
        }
      })
    }
  }

  public setMap = (
    map: Map<keyof TMap, TMap[keyof TMap]>,
    notify = true,
    skipSnapshot = false
  ) => {
    this.map = map

    this.sendToDevtools(
      'SET_MAP',
      { map: Object.fromEntries(map) },
      skipSnapshot
    )

    if (notify) {
      this.itemSubscribers.clear()
      this.itemSubscriberPaths.clear()
      this.sizeSubscribers.clear()
      this.keysSubscribers.clear()

      startTransition(() => {
        this.syncMap()
        this.syncSize()
        this.syncKeys()
      })
    }
  }

  public update = <P extends keyof TMap | Path<TMap>>(
    path: P,
    item: P extends keyof TMap
      ? Partial<TMap[P]> | ((prev: TMap[P]) => TMap[P])
      : P extends Path<TMap>
        ?
            | Partial<PathValue<TMap, P>>
            | ((prev: PathValue<TMap, P>) => PathValue<TMap, P>)
        : never,
    notify = true,
    skipSnapshot = false
  ) => {
    const pathArray = Array.isArray(path) ? path : [path]
    const topLevelKey = pathArray[0] as keyof TMap

    if (!this.map.has(topLevelKey)) {
      return
    }

    let data = this.map.get(topLevelKey) as any
    let updatedItem: any

    if (pathArray.length === 1) {
      // Top-level update
      if (typeof item === 'function') {
        updatedItem = (item as Function)(data)
      } else if (
        typeof item === 'object' &&
        item !== null &&
        !Array.isArray(item)
      ) {
        updatedItem = { ...data, ...item }
      } else {
        updatedItem = item
      }
      this.map.set(topLevelKey, updatedItem)
    } else {
      // Nested update
      updatedItem = { ...data }
      let current = updatedItem
      for (let i = 1; i < pathArray.length - 1; i++) {
        current = current[pathArray[i] as keyof typeof current]
        if (current === undefined || current === null) {
          return // Path doesn't exist, abort update
        }
      }
      const lastKey = pathArray[pathArray.length - 1] as keyof typeof current
      if (typeof item === 'function') {
        current[lastKey] = (item as Function)(current[lastKey])
      } else if (
        typeof item === 'object' &&
        item !== null &&
        !Array.isArray(item)
      ) {
        current[lastKey] = { ...current[lastKey], ...item }
      } else {
        current[lastKey] = item
      }
      this.map.set(topLevelKey, updatedItem)
    }

    this.sendToDevtools('UPDATE', { path, item: updatedItem }, skipSnapshot)

    if (notify) {
      startTransition(() => {
        this.syncItem(path)
      })
    }
  }

  public batchUpdate = <TMapKey extends keyof TMap>(
    updates: {
      [K in TMapKey]?: Partial<TMap[K]> | ((prev: TMap[K]) => TMap[K])
    },
    notify = true,
    skipSnapshot = false
  ) => {
    const updatedKeys = new Set<TMapKey>()
    for (const key in updates) {
      if (Object.prototype.hasOwnProperty.call(updates, key)) {
        const update = updates[key as TMapKey]
        if (update !== undefined) {
          this.update(key as keyof TMap, update as any, false)
          updatedKeys.add(key as TMapKey)
        }
      }
    }

    this.sendToDevtools('BATCH_UPDATE', { updates }, skipSnapshot)

    if (notify) {
      startTransition(() => {
        this.syncItems(Array.from(updatedKeys))
      })
    }
  }

  public remove = (key: keyof TMap, notify = true, skipSnapshot = false) => {
    this.map.delete(key)

    this.sendToDevtools('REMOVE', { key }, skipSnapshot)

    if (notify) {
      startTransition(() => {
        this.syncItem(key)
        this.syncSize()
        this.syncKeys()
      })
    }
  }

  // Subscribers

  public use = <P extends keyof TMap | Path<TMap>>(path: P) => {
    type ReturnType = P extends keyof TMap
      ? TMap[P]
      : PathValue<TMap, Extract<P, Path<TMap>>>
    const prevItem = useRef<ReturnType>()

    const subscribe = useCallback(
      (callback: () => void) => {
        const typedPath: Path<TMap> = Array.isArray(path)
          ? (path as Path<TMap>)
          : [path as keyof TMap]
        this.addSubscriber(typedPath, callback)

        return () => {
          this.removeSubscriber(typedPath, callback)
        }
      },
      [path]
    )

    const getSnapshot = useCallback(() => {
      const currentItem = Array.isArray(path)
        ? this.getScoped(path as Path<TMap>)
        : this.get(path as keyof TMap)

      if (!Object.is(currentItem, prevItem.current)) {
        prevItem.current = currentItem as ReturnType
      }
      return prevItem.current
    }, [path])

    return useSyncExternalStore(
      subscribe,
      getSnapshot,
      getSnapshot
    ) as ReturnType
  }

  public useSize = () => {
    const subscribe = useCallback((callback: () => void) => {
      this.sizeSubscribers.add(callback)
      return () => {
        this.sizeSubscribers.delete(callback)
      }
    }, [])

    const getSnapshot = useCallback(() => {
      return this.map.size
    }, [])

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  }

  public useKeys = (filter?: (_: TMap[keyof TMap], i: number) => boolean) => {
    const keysRef = useRef<(keyof TMap)[]>([])
    const sizeRef = useRef(0)
    const keysStringRef = useRef('')

    const subscribe = useCallback((callback: () => void) => {
      const unsubscribe = () => {
        this.keysSubscribers.delete(callback)
      }
      this.keysSubscribers.add(callback)
      return unsubscribe
    }, [])

    const getSnapshot = useCallback(() => {
      const currentSize = this.map.size

      if (currentSize !== sizeRef.current) {
        const currentKeys = Array.from(this.map.keys())
        const currentKeysString = currentKeys.join(',')
        if (currentKeysString !== keysStringRef.current) {
          keysRef.current = currentKeys
          keysStringRef.current = currentKeysString
          sizeRef.current = currentSize
        }
      }

      return keysRef.current
    }, [])

    const allKeys = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

    const filteredKeys = useMemo(() => {
      if (!filter) return allKeys
      return allKeys.filter((key, i) => filter(this.map.get(key)!, i))
    }, [allKeys, filter])

    return filteredKeys
  }
}
