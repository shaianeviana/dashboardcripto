/**
 * Pyth Network — Hermes SSE Stream (multi-feed)
 * Docs: https://docs.pyth.network/price-feeds/api-reference/hermes
 */

import type { PythPrice } from './types'

const HERMES = 'https://hermes.pyth.network'

export const PYTH_FEEDS = {
  BTC: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  ETH: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  SOL: '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
} as const

export type PythSymbol = keyof typeof PYTH_FEEDS

// ─── tipos internos ───────────────────────────────────────────────────────────

interface HermesRawPrice {
  price: string
  conf: string
  expo: number
  publish_time: number
}

interface HermesParsed {
  id: string
  price: HermesRawPrice
}

interface HermesResponse {
  parsed: HermesParsed[]
}

function parsePyth(p: HermesRawPrice): PythPrice {
  const mult = Math.pow(10, p.expo)
  return {
    price: parseFloat(p.price) * mult,
    conf:  parseFloat(p.conf)  * mult,
    age:   Math.round(Date.now() / 1000 - p.publish_time),
  }
}

// ─── SSE multi-feed ───────────────────────────────────────────────────────────

/**
 * Abre uma única conexão SSE para todos os feeds pedidos.
 * onUpdate é chamado a cada frame (~400ms) com um mapa símbolo→PythPrice.
 */
export function streamPyth(
  feeds: Partial<Record<PythSymbol, true>>,
  onUpdate: (prices: Partial<Record<PythSymbol, PythPrice>>) => void,
  onError?: (e: Error) => void,
): () => void {
  // mapeia feedId (lowercase) → símbolo para lookup rápido
  const idToSymbol = new Map<string, PythSymbol>()
  const params = new URLSearchParams()

  for (const sym of Object.keys(feeds) as PythSymbol[]) {
    const id = PYTH_FEEDS[sym]
    idToSymbol.set(id.toLowerCase().replace('0x', ''), sym)
    params.append('ids[]', id)
  }
  params.set('parsed', 'true')

  const url = `${HERMES}/v2/updates/price/stream?${params}`
  let es: EventSource
  let closed = false

  const connect = () => {
    es = new EventSource(url)

    es.onmessage = (e: MessageEvent) => {
      try {
        const data: HermesResponse = JSON.parse(e.data as string)
        const out: Partial<Record<PythSymbol, PythPrice>> = {}
        for (const p of data.parsed) {
          const sym = idToSymbol.get(p.id.toLowerCase().replace('0x', ''))
          if (sym) out[sym] = parsePyth(p.price)
        }
        if (Object.keys(out).length) onUpdate(out)
      } catch { /* ignora frames malformados */ }
    }

    es.onerror = () => {
      es.close()
      if (!closed) {
        onError?.(new Error('Pyth SSE desconectado, reconectando...'))
        setTimeout(connect, 3000)
      }
    }
  }

  connect()
  return () => { closed = true; es?.close() }
}

// ─── fetch único (fallback / inicialização) ───────────────────────────────────

export async function fetchPythBTC(): Promise<PythPrice> {
  const res = await fetch(
    `${HERMES}/v2/updates/price/latest?ids[]=${PYTH_FEEDS.BTC}&parsed=true`
  )
  if (!res.ok) throw new Error(`Pyth HTTP ${res.status}`)
  const data: HermesResponse = await res.json()
  return parsePyth(data.parsed[0].price)
}

// mantido para compatibilidade
export const streamPythBTC = (
  onUpdate: (p: PythPrice) => void,
  onError?: (e: Error) => void,
) =>
  streamPyth({ BTC: true }, prices => {
    if (prices.BTC) onUpdate(prices.BTC)
  }, onError)
