import type { Kline, TickerStats } from './types'

const REST = 'https://api.binance.com/api/v3'
const WS   = 'wss://stream.binance.com:9443/ws'

// ─── REST ─────────────────────────────────────────────────────────────────────

export async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number,
  startTime?: number,
  endTime?: number
): Promise<Kline[]> {
  const params = new URLSearchParams({ symbol, interval, limit: String(limit) })
  if (startTime) params.set('startTime', String(startTime))
  if (endTime)   params.set('endTime',   String(endTime))

  const res = await fetch(`${REST}/klines?${params}`)
  if (!res.ok) throw new Error(`Binance klines ${symbol} HTTP ${res.status}`)

  const raw: [number, string, string, string, string, ...unknown[]][] = await res.json()
  return raw.map(k => ({ time: k[0], close: parseFloat(k[4]) }))
}

// ─── Preço ao vivo de MON (multi-exchange fallback) ───────────────────────────

const get = (url: string) =>
  fetch(url, { signal: AbortSignal.timeout(8_000) }).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })

export async function fetchMonPrice(): Promise<number> {
  // 1) Binance
  try {
    const d = await get(`${REST}/ticker/price?symbol=MONUSDT`)
    if (d?.price) return parseFloat(d.price)
  } catch { /* segue */ }

  // 2) Bybit
  try {
    const d = await get('https://api.bybit.com/v5/market/tickers?category=spot&symbol=MONUSDT')
    const price = d?.result?.list?.[0]?.lastPrice
    if (price) return parseFloat(price)
  } catch { /* segue */ }

  // 3) OKX
  try {
    const d = await get('https://www.okx.com/api/v5/market/ticker?instId=MON-USDT')
    const price = d?.data?.[0]?.last
    if (price) return parseFloat(price)
  } catch { /* segue */ }

  // 4) MEXC
  try {
    const d = await get('https://api.mexc.com/api/v3/ticker/price?symbol=MONUSDT')
    if (d?.price) return parseFloat(d.price)
  } catch { /* segue */ }

  // 5) Gate.io
  try {
    const d: { last?: string }[] = await get('https://api.gateio.ws/api/v4/spot/tickers?currency_pair=MON_USDT')
    const price = d?.[0]?.last
    if (price) return parseFloat(price)
  } catch { /* segue */ }

  // 6) KuCoin
  try {
    const d = await get('https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=MON-USDT')
    const price = d?.data?.price
    if (price) return parseFloat(price)
  } catch { /* segue */ }

  throw new Error('MON não encontrado em nenhuma exchange')
}

/** Polling contínuo do preço de MON */
export function startMonPolling(
  onUpdate: (price: number) => void,
  onError: (e: Error) => void,
  intervalMs = 10_000
): () => void {
  let timer: ReturnType<typeof setTimeout>

  const poll = async () => {
    try {
      onUpdate(await fetchMonPrice())
    } catch (e) {
      onError(e instanceof Error ? e : new Error(String(e)))
    }
    timer = setTimeout(poll, intervalMs)
  }

  poll()
  return () => clearTimeout(timer)
}

// ─── WebSocket ────────────────────────────────────────────────────────────────

interface BinanceTicker {
  c: string   // last price
  P: string   // price change percent
  h: string   // high
  l: string   // low
  q: string   // quote asset volume (USD)
  v: string   // base asset volume (BTC)
}

export function connectTickerWS(
  symbol: string,
  onTick: (s: TickerStats) => void,
  onStatusChange: (connected: boolean) => void
): () => void {
  let ws: WebSocket
  let retryTimer: ReturnType<typeof setTimeout>
  let destroyed = false

  const connect = () => {
    ws = new WebSocket(`${WS}/${symbol.toLowerCase()}@ticker`)

    ws.onopen  = () => onStatusChange(true)
    ws.onerror = () => onStatusChange(false)
    ws.onclose = () => {
      onStatusChange(false)
      if (!destroyed) retryTimer = setTimeout(connect, 4000)
    }

    ws.onmessage = (e: MessageEvent) => {
      const d: BinanceTicker = JSON.parse(e.data as string)
      onTick({
        price:      parseFloat(d.c),
        change24h:  parseFloat(d.P),
        high24h:    parseFloat(d.h),
        low24h:     parseFloat(d.l),
        volumeUSD:  parseFloat(d.q),
        volumeBTC:  parseFloat(d.v),
      })
    }
  }

  connect()

  return () => {
    destroyed = true
    clearTimeout(retryTimer)
    ws?.close()
  }
}
