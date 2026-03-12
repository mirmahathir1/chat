export interface BackendRelayPollingOptions<T> {
  intervalMs: number
  poll: () => Promise<T | null>
  signal?: AbortSignal
}

export async function pollBackendRelay<T>({
  intervalMs,
  poll,
  signal,
}: BackendRelayPollingOptions<T>): Promise<T> {
  while (true) {
    signal?.throwIfAborted()

    const result = await poll()

    if (result !== null) {
      return result
    }

    await delay(intervalMs, signal)
  }
}

function delay(durationMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup()
      resolve()
    }, durationMs)

    const abortListener = () => {
      cleanup()
      reject(new DOMException('Relay polling was aborted.', 'AbortError'))
    }

    const cleanup = () => {
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', abortListener)
    }

    signal?.addEventListener('abort', abortListener, {
      once: true,
    })
  })
}
