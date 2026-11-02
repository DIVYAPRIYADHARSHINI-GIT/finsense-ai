/**
 * React access to the Pyodide ML worker.
 *
 * One worker instance is shared by the whole app, so the ~9 s Python boot and
 * wheel download happens once per session rather than once per page. Jobs are
 * promise-based and correlated by id; progress messages feed the real loading
 * indicators.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MLJob, MLProgressStage, MLRequest, MLResponse } from '../ml/protocol'

export interface MLStatus {
  booted: boolean
  busy: boolean
  stage: MLProgressStage | 'idle'
  message: string
  error: string | null
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

let sharedWorker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()
const progressListeners = new Set<(stage: MLProgressStage, message: string) => void>()

function getWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL('../ml/worker.ts', import.meta.url), { type: 'module' })
    sharedWorker.onmessage = (event: MessageEvent<MLResponse>) => {
      const msg = event.data
      if (msg.kind === 'progress') {
        for (const l of progressListeners) l(msg.stage, msg.message)
        return
      }
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.kind === 'result') p.resolve(msg.data)
      else p.reject(new Error(msg.message))
    }
    sharedWorker.onerror = (e) => {
      const err = new Error(e.message || 'The ML worker crashed. Reload the page to restart Python.')
      for (const [, p] of pending) p.reject(err)
      pending.clear()
    }
  }
  return sharedWorker
}

export function runMLJob<T>(job: MLJob, payload: unknown): Promise<T> {
  const worker = getWorker()
  const id = nextId++
  const req: MLRequest = { id, job, payload }
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    worker.postMessage(req)
  })
}

export function useMLWorker() {
  const [status, setStatus] = useState<MLStatus>({
    booted: false,
    busy: false,
    stage: 'idle',
    message: 'Python ML runtime not started',
    error: null,
  })
  const inflight = useRef(0)

  useEffect(() => {
    const listener = (stage: MLProgressStage, message: string) => {
      setStatus((s) => ({
        ...s,
        stage,
        message,
        booted: s.booted || stage === 'done',
      }))
    }
    progressListeners.add(listener)
    return () => {
      progressListeners.delete(listener)
    }
  }, [])

  const run = useCallback(async <T,>(job: MLJob, payload: unknown): Promise<T> => {
    inflight.current += 1
    setStatus((s) => ({ ...s, busy: true, error: null }))
    try {
      const result = await runMLJob<T>(job, payload)
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setStatus((s) => ({ ...s, error: message }))
      throw err
    } finally {
      inflight.current -= 1
      if (inflight.current <= 0) setStatus((s) => ({ ...s, busy: false, stage: 'done' }))
    }
  }, [])

  return useMemo(() => ({ status, run }), [status, run])
}
