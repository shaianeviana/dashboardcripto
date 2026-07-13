import {
  Chart,
  LineController,
  LineElement,
  BarController,
  BarElement,
  PointElement,
  LinearScale,
  LogarithmicScale,
  CategoryScale,
  TimeScale,
  Filler,
  Legend,
  Tooltip,
} from 'chart.js'
import zoomPlugin from 'chartjs-plugin-zoom'
import type { Kline, Candle } from './types'
import { fetchKlines, fetchCandles } from './binance'

Chart.register(LineController, LineElement, BarController, BarElement, PointElement, LinearScale, LogarithmicScale, CategoryScale, TimeScale, Filler, Legend, Tooltip, zoomPlugin)

// ─── helpers ─────────────────────────────────────────────────────────────────

const GRID  = '#21262d'
const XAXIS = { ticks: { color: '#8b949e' as const }, grid: { color: GRID } }
const YAXIS = { ticks: { color: '#8b949e' as const }, grid: { color: GRID } }

// Pan (arrastar) + zoom (scroll/pinça) no eixo X, com limite mínimo de 5 pontos visíveis.
const ZOOM_OPTS = {
  pan:  { enabled: true, mode: 'x' as const, threshold: 5 },
  zoom: {
    wheel: { enabled: true },
    pinch: { enabled: true },
    mode:  'x' as const,
  },
  limits: { x: { minRange: 5 } },
}

function destroy(ref: Chart | null): null {
  ref?.destroy()
  return null
}

/** Duplo-clique no gráfico reseta o zoom/pan (chartjs-plugin-zoom não tem gesto padrão). */
function enableZoomReset(chart: Chart): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chart.canvas.ondblclick = () => (chart as any).resetZoom()
}

function dateFmt(ts: number, showTime: boolean): string {
  return showTime
    ? new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

/** Atualiza o último ponto de um dataset sem animação (não chama update — chamar depois) */
function setLast(chart: Chart, datasetIdx: number, value: number): void {
  const data = chart.data.datasets[datasetIdx].data as number[]
  if (data.length) data[data.length - 1] = value
}

// ─── Plugin: linha de preço atual + label flutuante (price chart) ─────────────

const lastPricePlugin = {
  id: 'lastPrice',
  afterDraw(chart: Chart) {
    const ds   = chart.data.datasets[0]
    const data = ds.data as number[]
    if (!data.length) return

    const lastVal = data[data.length - 1]
    const yScale  = chart.scales['y']
    const xScale  = chart.scales['x']
    if (!yScale || !xScale) return

    const y     = yScale.getPixelForValue(lastVal)
    const left  = xScale.left
    const right = xScale.right
    const color = (ds.borderColor as string) ?? '#58a6ff'
    const ctx   = chart.ctx

    ctx.save()

    // linha tracejada horizontal
    ctx.setLineDash([5, 5])
    ctx.strokeStyle = color + 'aa'
    ctx.lineWidth   = 1
    ctx.beginPath()
    ctx.moveTo(left, y)
    ctx.lineTo(right - 72, y)
    ctx.stroke()

    // ponto pulsante no final da linha
    ctx.setLineDash([])
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(right - 80, y, 4, 0, Math.PI * 2)
    ctx.fill()

    // label de preço
    const label   = '$' + lastVal.toLocaleString('en-US', { maximumFractionDigits: 0 })
    const padX    = 6
    const padY    = 5
    const fontSize = 11
    ctx.font      = `600 ${fontSize}px -apple-system, sans-serif`
    const tw      = ctx.measureText(label).width
    const bw      = tw + padX * 2
    const bh      = fontSize + padY * 2
    const bx      = right - bw
    const by      = y - bh / 2

    ctx.fillStyle   = color
    ctx.beginPath()
    ctx.roundRect(bx, by, bw, bh, 3)
    ctx.fill()

    ctx.fillStyle  = '#0d1117'
    ctx.textAlign  = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, bx + padX, y)

    ctx.restore()
  },
}

// ─── Plugin: ponto vivo no último valor (todos os gráficos) ──────────────────

const liveDotsPlugin = {
  id: 'liveDots',
  afterDraw(chart: Chart) {
    const ctx = chart.ctx
    const yScale = chart.scales['y']
    const xScale = chart.scales['x']
    if (!yScale || !xScale) return

    const colors: Record<number, string> = {
      0: '#f7931a', 1: '#627eea', 2: '#36d399', 3: '#9945ff',
    }

    chart.data.datasets.forEach((ds, i) => {
      const data = ds.data as number[]
      if (!data.length) return
      const lastVal = data[data.length - 1]
      if (!isFinite(lastVal)) return

      const x     = xScale.getPixelForValue(data.length - 1)
      const y     = yScale.getPixelForValue(lastVal)
      const color = (ds.borderColor as string) ?? colors[i] ?? '#58a6ff'

      ctx.save()
      // halo
      ctx.fillStyle = color + '33'
      ctx.beginPath()
      ctx.arc(x, y, 7, 0, Math.PI * 2)
      ctx.fill()
      // ponto central
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(x, y, 3.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    })
  },
}

// ─── Gráfico de preço ─────────────────────────────────────────────────────────

let priceChart: Chart | null = null
let priceFirstVal = 0

export async function renderPriceChart(canvas: HTMLCanvasElement, days: number): Promise<void> {
  const interval = days <= 1 ? '1h' : days <= 7 ? '4h' : '1d'
  const limit    = days <= 1 ? 24  : days <= 7 ? 42   : Math.min(days, 365)
  const klines   = await fetchKlines('BTCUSDT', interval, limit)

  const labels = klines.map(k => dateFmt(k.time, days <= 1))
  const data   = klines.map(k => k.close)
  priceFirstVal = data[0]

  const up    = data[data.length - 1] >= data[0]
  const color = up ? '#3fb950' : '#f85149'

  priceChart = destroy(priceChart)
  priceChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'BTC/USDT',
        data,
        borderColor: color,
        backgroundColor: color + '18',
        fill: true,
        tension: 0.25,
        pointRadius: 0,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2128',
          borderColor: '#30363d',
          borderWidth: 1,
          titleColor: '#8b949e',
          bodyColor: '#e6edf3',
          padding: 10,
          callbacks: {
            label: ctx => `BTC: $${(ctx.parsed.y ?? 0).toLocaleString('en-US')}`,
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        zoom: ZOOM_OPTS as any,
      },
      scales: {
        x: { ...XAXIS, ticks: { ...XAXIS.ticks, maxTicksLimit: 8 } },
        y: { ...YAXIS, ticks: { ...YAXIS.ticks, callback: v => '$' + Number(v).toLocaleString('en-US') } },
      },
    },
    plugins: [lastPricePlugin],
  })
  enableZoomReset(priceChart)
}

/** Atualiza o último candle do gráfico de preço com o preço ao vivo */
export function tickPriceChart(btcPrice: number): void {
  if (!priceChart) return
  const up    = btcPrice >= priceFirstVal
  const color = up ? '#3fb950' : '#f85149'
  setLast(priceChart, 0, btcPrice)
  priceChart.data.datasets[0].borderColor     = color
  priceChart.data.datasets[0].backgroundColor = color + '18'
  priceChart.update('none')
}

// ─── Ciclos sobrepostos ───────────────────────────────────────────────────────

let cyclesChart: Chart | null = null

export async function renderCyclesChart(canvas: HTMLCanvasElement): Promise<void> {
  const t1a = new Date('2021-01-01').getTime()
  const t1b = new Date('2023-06-01').getTime()
  const t2a = new Date('2024-10-01').getTime()

  const [w1, w2] = await Promise.all([
    fetchKlines('BTCUSDT', '1d', 1000, t1a, t1b),
    fetchKlines('BTCUSDT', '1d', 1000, t2a, Date.now()),
  ])

  const topIdx = (arr: Kline[]) => arr.reduce((m, p, i, a) => p.close > a[m].close ? i : m, 0)
  const i1 = topIdx(w1), i2 = topIdx(w2)

  const fromTop = (arr: Kline[], i: number): number[] => {
    const out: number[] = []
    for (let k = i; k < arr.length; k += 30)
      out.push(parseFloat((arr[k].close / 1000).toFixed(2)))
    return out
  }

  const c1 = fromTop(w1, i1)
  const c2 = fromTop(w2, i2)
  const n  = Math.max(c1.length, c2.length)
  const labels = Array.from({ length: n }, (_, i) => `M+${i}`)

  cyclesChart = destroy(cyclesChart)
  cyclesChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: `Ciclo 2021/22 (topo $${(w1[i1].close / 1000).toFixed(0)}k)`, data: c1, borderColor: '#f85149', backgroundColor: '#f8514918', fill: true, tension: .3, borderWidth: 2, pointRadius: 0 },
        { label: `Ciclo 2024/25 (topo $${(w2[i2].close / 1000).toFixed(0)}k)`, data: c2, borderColor: '#3fb950', backgroundColor: '#3fb95018', fill: true, tension: .3, borderWidth: 2, pointRadius: 0 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#e6edf3' } },
        tooltip: { callbacks: { label: c => c.dataset.label!.split(' (')[0] + ': $' + (c.parsed.y ?? 0).toFixed(1) + 'k' } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        zoom: ZOOM_OPTS as any,
      },
      scales: {
        x: XAXIS,
        y: { ...YAXIS, ticks: { ...YAXIS.ticks, callback: v => '$' + v + 'k' } },
      },
    },
    plugins: [liveDotsPlugin],
  })
  enableZoomReset(cyclesChart)
}

/** Atualiza o último ponto do ciclo atual com o preço ao vivo (em k$) */
export function tickCyclesChart(btcPrice: number): void {
  if (!cyclesChart) return
  setLast(cyclesChart, 1, parseFloat((btcPrice / 1000).toFixed(2)))
  cyclesChart.update('none')
}

// ─── BTC vs MON ───────────────────────────────────────────────────────────────

/** Tenta várias exchanges em sequência até achar dados de MON. */
async function fetchMonKlines(): Promise<{ klines: Kline[]; source: string }> {
  const get = (url: string) =>
    fetch(url, { signal: AbortSignal.timeout(10_000) }).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    })

  // 1) Binance
  try {
    const klines = await fetchKlines('MONUSDT', '1d', 1000)
    if (klines.length > 0) return { klines, source: 'Binance' }
  } catch { /* segue */ }

  // 2) Bybit  (newest-first → reverse)
  try {
    const d = await get('https://api.bybit.com/v5/market/kline?category=spot&symbol=MONUSDT&interval=D&limit=500')
    const rows: [string, string, string, string, string][] = d?.result?.list ?? []
    if (rows.length > 0) {
      const klines: Kline[] = rows.map(r => ({ time: Number(r[0]), close: parseFloat(r[4]) })).reverse()
      return { klines, source: 'Bybit' }
    }
  } catch { /* segue */ }

  // 3) OKX  (newest-first → reverse)
  try {
    const d = await get('https://www.okx.com/api/v5/market/history-candles?instId=MON-USDT&bar=1D&limit=300')
    const rows: string[][] = d?.data ?? []
    if (rows.length > 0) {
      const klines: Kline[] = rows.map(r => ({ time: Number(r[0]), close: parseFloat(r[4]) })).reverse()
      return { klines, source: 'OKX' }
    }
  } catch { /* segue */ }

  // 4) MEXC
  try {
    const d: [number, string, string, string, string][] =
      await get('https://api.mexc.com/api/v3/klines?symbol=MONUSDT&interval=1d&limit=500')
    if (d?.length > 0) {
      const klines: Kline[] = d.map(r => ({ time: r[0], close: parseFloat(r[4]) }))
      return { klines, source: 'MEXC' }
    }
  } catch { /* segue */ }

  // 5) Gate.io  (time em segundos, [ts, vol, close, high, low, open])
  try {
    const d: [string, string, string, string, string, string][] =
      await get('https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=MON_USDT&interval=1d&limit=1000')
    if (d?.length > 0) {
      const klines: Kline[] = d.map(r => ({ time: Number(r[0]) * 1000, close: parseFloat(r[2]) }))
      return { klines, source: 'Gate.io' }
    }
  } catch { /* segue */ }

  // 6) KuCoin  (time em segundos, newest-first, [ts, open, close, ...])
  try {
    const d = await get('https://api.kucoin.com/api/v1/market/candles?type=1day&symbol=MON-USDT')
    const rows: string[][] = d?.data ?? []
    if (rows.length > 0) {
      const klines: Kline[] = rows.map(r => ({ time: Number(r[0]) * 1000, close: parseFloat(r[2]) })).reverse()
      return { klines, source: 'KuCoin' }
    }
  } catch { /* segue */ }

  // 7) CoinGecko
  for (const id of ['monad-2', 'monad', 'mon', 'monad-token']) {
    try {
      const d: { prices?: [number, number][] } =
        await get(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=max&interval=daily`)
      if (d.prices?.length) {
        return { klines: d.prices.map(([time, close]) => ({ time, close })), source: `CoinGecko (${id})` }
      }
    } catch { /* segue */ }
  }

  throw new Error('MON não encontrado em nenhuma exchange.')
}

function normalize(arr: Kline[]): number[] {
  const base = arr[0].close
  return arr.map(k => parseFloat((k.close / base * 100).toFixed(4)))
}

async function fetchAligned(symbol: string, monKlines: Kline[]): Promise<{ data: number[]; basePrice: number }> {
  const startTs = monKlines[0].time
  const endTs   = monKlines[monKlines.length - 1].time
  const daySpan = Math.ceil((endTs - startTs) / 86_400_000) + 5
  const klines  = await fetchKlines(symbol, '1d', Math.min(daySpan, 1000), startTs)

  const byDay = new Map<string, number>()
  for (const k of klines) byDay.set(new Date(k.time).toISOString().slice(0, 10), k.close)

  const baseDay = new Date(monKlines[0].time).toISOString().slice(0, 10)
  const basePrice = byDay.get(baseDay)
  if (!basePrice) throw new Error(`${symbol} sem dado na data inicial do MON`)

  const data = monKlines.map(k => {
    const day = new Date(k.time).toISOString().slice(0, 10)
    const v   = byDay.get(day)
    return v !== undefined ? parseFloat((v / basePrice * 100).toFixed(4)) : NaN
  })

  return { data, basePrice }
}

// base prices e raw data para tooltip com preço real
const compBase:    Record<string, number>   = {}
const compRaw:     Record<string, number[]> = {}   // preços reais por índice
const compSymbols  = ['BTC', 'ETH', 'SOL', 'MON'] as const
let compChart: Chart | null = null

export async function renderBtcMonChart(canvas: HTMLCanvasElement): Promise<void> {
  const { klines: monKlines, source } = await fetchMonKlines()

  const [monN, btcR, ethR, solR] = await Promise.all([
    Promise.resolve(normalize(monKlines)),
    fetchAligned('BTCUSDT', monKlines),
    fetchAligned('ETHUSDT', monKlines),
    fetchAligned('SOLUSDT', monKlines),
  ])

  compBase.BTC = btcR.basePrice
  compBase.ETH = ethR.basePrice
  compBase.SOL = solR.basePrice
  // raw prices para tooltip (normalizado * base / 100 = preço real)
  compRaw.BTC = btcR.data.map(v => isNaN(v) ? NaN : (v / 100) * btcR.basePrice)
  compRaw.ETH = ethR.data.map(v => isNaN(v) ? NaN : (v / 100) * ethR.basePrice)
  compRaw.SOL = solR.data.map(v => isNaN(v) ? NaN : (v / 100) * solR.basePrice)
  compRaw.MON = monKlines.map(k => k.close)

  const labels = monKlines.map(k => dateFmt(k.time, false))

  // decimais por ativo
  const fmtPrice = (sym: string, price: number) => {
    if (!isFinite(price)) return '—'
    const dec = sym === 'SOL' || sym === 'MON' ? 3 : 2
    return '$' + price.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
  }

  compChart = destroy(compChart)
  compChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'BTC',             data: btcR.data, borderColor: '#f7931a', fill: false, tension: .25, pointRadius: 0, borderWidth: 2, spanGaps: true },
        { label: 'ETH',             data: ethR.data, borderColor: '#627eea', fill: false, tension: .25, pointRadius: 0, borderWidth: 2, spanGaps: true },
        { label: 'SOL',             data: solR.data, borderColor: '#36d399', fill: false, tension: .25, pointRadius: 0, borderWidth: 2, spanGaps: true },
        { label: `MON · ${source}`, data: monN,      borderColor: '#9945ff', fill: false, tension: .25, pointRadius: 0, borderWidth: 2 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#e6edf3' } },
        tooltip: {
          backgroundColor: '#1c2128',
          borderColor: '#30363d',
          borderWidth: 1,
          titleColor: '#8b949e',
          bodyColor: '#e6edf3',
          padding: 10,
          callbacks: {
            title: (items) => items[0]?.label ?? '',
            label: (c) => {
              const sym   = compSymbols[c.datasetIndex] ?? 'BTC'
              const name  = c.dataset.label?.split(' ·')[0] ?? sym
              const idx   = c.dataIndex
              const raw   = compRaw[sym]?.[idx]
              const norm  = c.parsed.y ?? 0
              const diff  = norm - 100
              const sign  = diff >= 0 ? '+' : ''
              const price = fmtPrice(sym, raw ?? NaN)
              return `  ${name}: ${price}   ${sign}${diff.toFixed(2)}% desde início do MON`
            },
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        zoom: ZOOM_OPTS as any,
      },
      scales: {
        x: { ...XAXIS, ticks: { ...XAXIS.ticks, maxTicksLimit: 10 } },
        y: { ...YAXIS, ticks: { ...YAXIS.ticks, callback: v => Number(v).toFixed(0) } },
      },
    },
    plugins: [liveDotsPlugin],
  })
  enableZoomReset(compChart)
}

/** Reseta o zoom do gráfico de comparação */
export function resetComparisonZoom(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(compChart as any)?.resetZoom()
}

// ─── Bull/Bear Tide ───────────────────────────────────────────────────────────

export interface BullBearResult {
  deviation: number
  sma200: number
  price: number
}

interface BbtCache {
  labels:     string[]
  deviations: number[]
  prices:     number[]
  sma200vals: number[]
}

let bbtCache: BbtCache | null = null
let bullBearTideChart: Chart | null = null

/** Busca histórico completo do BTC — CryptoCompare (2014→hoje) com fallback Binance paginado */
async function fetchBtcHistory(): Promise<{ time: number; price: number }[]> {

  // ── 1) CryptoCompare: gratuito, CORS liberado, dados desde 2010 ─────────
  try {
    const cc = async (toTs?: number): Promise<{ time: number; price: number }[]> => {
      const base = 'https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USD&limit=2000'
      const url  = toTs ? base + '&toTs=' + toTs : base
      const r    = await fetch(url, { signal: AbortSignal.timeout(12_000) })
      if (!r.ok) throw new Error('CC HTTP ' + r.status)
      const j: { Data?: { Data?: { time: number; close: number }[] } } = await r.json()
      const rows = j?.Data?.Data ?? []
      return rows
        .filter(d => d.close > 0)
        .map(d => ({ time: d.time * 1000, price: d.close }))
    }

    // Bloco recente (últimos ~5.5 anos)
    const recent = await cc()
    if (recent.length < 100) throw new Error('CC: poucos dados')

    // Bloco antigo (antes do mais antigo do bloco recente)
    const oldestSec = Math.floor(recent[0].time / 1000)
    const older     = await cc(oldestSec)

    // Mescla sem duplicatas
    const combined = [
      ...older.filter(d => d.time < recent[0].time),
      ...recent,
    ]
    if (combined.length > 500) return combined
  } catch { /* passa para fallback */ }

  // ── 2) Fallback: Binance paginado (agosto/2017→hoje) ────────────────────
  const DAY_MS    = 86_400_000
  const allData:  { time: number; price: number }[] = []
  let startTime   = new Date('2017-08-17').getTime()

  while (startTime < Date.now()) {
    const batch = await fetchKlines('BTCUSDT', '1d', 1000, startTime)
    if (!batch.length) break
    allData.push(...batch.map(k => ({ time: k.time, price: k.close })))
    if (batch.length < 1000) break
    startTime = batch[batch.length - 1].time + DAY_MS
  }

  if (allData.length > 200) return allData
  throw new Error('Histórico BTC indisponível')
}

/** Slicing por quantidade de dias a exibir (ou 'all') */
function bbtSlice(cache: BbtCache, days: number | 'all'): BbtCache {
  if (days === 'all') return cache
  const n = Math.min(days, cache.labels.length)
  return {
    labels:     cache.labels.slice(-n),
    deviations: cache.deviations.slice(-n),
    prices:     cache.prices.slice(-n),
    sma200vals: cache.sma200vals.slice(-n),
  }
}

/** Atualiza o gráfico único para um novo range sem refetch */
export function updateBullBearRange(days: number | 'all'): void {
  if (!bbtCache || !bullBearTideChart) return
  const v  = bbtSlice(bbtCache, days)
  const bg = v.deviations.map(d => d >= 0 ? '#3fb95088' : '#f8514988')

  bullBearTideChart.data.labels                      = v.labels
  bullBearTideChart.data.datasets[0].data            = v.deviations
  bullBearTideChart.data.datasets[0].backgroundColor = bg
  bullBearTideChart.data.datasets[1].data            = v.prices
  bullBearTideChart.update()   // update completo → recalcula os ticks do eixo X
}

export async function renderBullBearTide(
  canvas: HTMLCanvasElement,
  days: number | 'all' = 'all',
): Promise<BullBearResult> {
  // ── Busca e processa dados (com cache) ────────────────────────────────────
  if (!bbtCache) {
    const raw    = await fetchBtcHistory()
    const prices = raw.map(d => d.price)

    // SMA 200
    const sma200: number[] = prices.map((_, i) => {
      if (i < 199) return NaN
      let s = 0; for (let k = i - 199; k <= i; k++) s += prices[k]
      return s / 200
    })

    const start        = 199
    const slicedRaw    = raw.slice(start)
    const slicedPrices = prices.slice(start)
    const slicedSma    = sma200.slice(start)

    bbtCache = {
      labels:     slicedRaw.map(d =>
        new Date(d.time).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
      ),
      deviations: slicedPrices.map((p, i) =>
        parseFloat(((p - slicedSma[i]) / slicedSma[i] * 100).toFixed(2))),
      prices:     slicedPrices,
      sma200vals: slicedSma,
    }
  }

  const v  = bbtSlice(bbtCache, days)
  const bg = v.deviations.map(d => d >= 0 ? '#3fb95088' : '#f8514988')

  // ── Gráfico único: barras bull/bear (esq.) + linha de preço (dir.) ────────
  bullBearTideChart = destroy(bullBearTideChart)
  bullBearTideChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: v.labels,
      datasets: [
        {
          type: 'bar' as const,
          label: 'Desvio SMA 200',
          data: v.deviations,
          backgroundColor: bg,
          borderWidth: 0,
          yAxisID: 'yDev',
          order: 2,
        },
        {
          type: 'line' as const,
          label: 'BTC Price',
          data: v.prices,
          borderColor: '#e6edf3cc',
          borderWidth: 1.5,
          fill: false,
          tension: 0.15,
          pointRadius: 0,
          yAxisID: 'yPrice',
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index' as const,
          intersect: false,
          callbacks: {
            title: items => items[0]?.label ?? '',
            label: ctx => {
              if (ctx.datasetIndex === 0) {
                const val  = ctx.parsed.y ?? 0
                const sign = val >= 0 ? '+' : ''
                return `${val >= 0 ? 'BULL' : 'BEAR'}: ${sign}${val.toFixed(2)}% vs SMA 200`
              }
              const price = ctx.parsed.y ?? 0
              return `BTC: $${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
            },
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        zoom: ZOOM_OPTS as any,
      },
      scales: {
        x: { ...XAXIS, ticks: { ...XAXIS.ticks, maxTicksLimit: 10 } },
        yDev: {
          position: 'left' as const,
          ticks: { color: '#8b949e', callback: v => Number(v).toFixed(0) + '%' },
          grid: { color: (ctx) => ctx.tick.value === 0 ? '#ffffff55' : GRID },
        },
        yPrice: {
          position: 'right' as const,
          ticks: {
            color: '#8b949e',
            callback: v => '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }),
          },
          grid: { drawOnChartArea: false },
        },
      },
    },
  })
  enableZoomReset(bullBearTideChart)

  const last = v.deviations.length - 1
  return {
    deviation: v.deviations[last],
    sma200:    v.sma200vals[last],
    price:     v.prices[last],
  }
}

// ─── NUPL (Net Unrealized Profit/Loss) ───────────────────────────────────────

export interface NuplResult {
  nupl:  number
  phase: string
  color: string
}

const NUPL_PHASES = [
  { min: -Infinity, label: 'Capitulation',       color: '#f85149' },
  { min: 0,         label: 'Hope → Fear',         color: '#e6855a' },
  { min: 0.25,      label: 'Optimism → Anxiety',  color: '#e6b450' },
  { min: 0.5,       label: 'Belief → Denial',     color: '#3fb950' },
  { min: 0.75,      label: 'Euphoria → Greed',    color: '#58a6ff' },
] as const

function nuplPhaseInfo(v: number): { label: string; color: string } {
  for (let i = NUPL_PHASES.length - 1; i >= 0; i--) {
    if (v >= NUPL_PHASES[i].min) return NUPL_PHASES[i]
  }
  return NUPL_PHASES[0]
}

const nuplZonesPlugin = {
  id: 'nuplZones',
  beforeDatasetsDraw(chart: Chart) {
    const { ctx, chartArea, scales } = chart
    const y = scales['yNupl']
    if (!chartArea || !y) return

    const zones = [
      { from: -Infinity, to: 0,        fill: '#f8514914' },
      { from: 0,         to: 0.25,     fill: '#e6855a14' },
      { from: 0.25,      to: 0.5,      fill: '#e6b45014' },
      { from: 0.5,       to: 0.75,     fill: '#3fb95014' },
      { from: 0.75,      to: Infinity, fill: '#58a6ff14' },
    ]

    ctx.save()
    ctx.beginPath()
    ctx.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height)
    ctx.clip()

    for (const zone of zones) {
      const top    = y.getPixelForValue(Math.min(zone.to,   y.max))
      const bottom = y.getPixelForValue(Math.max(zone.from, y.min))
      ctx.fillStyle = zone.fill
      ctx.fillRect(chartArea.left, top, chartArea.width, bottom - top)
    }

    const y0 = y.getPixelForValue(0)
    if (y0 >= chartArea.top && y0 <= chartArea.bottom) {
      ctx.strokeStyle = '#ffffff33'
      ctx.lineWidth   = 1
      ctx.setLineDash([5, 5])
      ctx.beginPath()
      ctx.moveTo(chartArea.left, y0)
      ctx.lineTo(chartArea.right, y0)
      ctx.stroke()
      ctx.setLineDash([])
    }

    ctx.restore()
  },
}

let nuplChart: Chart | null = null
let mvrvChart: Chart | null = null

interface CMRow {
  time:           string
  CapMrktCurUSD?: string | null
  CapRealUSD?:    string | null
  PriceUSD?:      string | null
}

let cmRowsCache:   CMRow[] | null           = null
let cmRowsPromise: Promise<CMRow[]> | null  = null

async function fetchNuplRowsUncached(): Promise<CMRow[]> {
  // community-api é pública (sem chave); api.coinmetrics.io exige auth (401)
  const COMMUNITY = 'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics' +
                    '?assets=btc&metrics=CapMrktCurUSD,CapRealUSD,PriceUSD&frequency=1d&page_size=5000'
  const SRCS = [
    COMMUNITY,
    'https://api.allorigins.win/raw?url='  + encodeURIComponent(COMMUNITY),
    'https://corsproxy.io/?'               + encodeURIComponent(COMMUNITY),
    'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(COMMUNITY),
  ]

  for (const url of SRCS) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(18_000) })
      if (!r.ok) continue
      const j: { data?: CMRow[] } = await r.json()
      const rows = (j.data ?? []).filter(d => d.CapMrktCurUSD && d.CapRealUSD)
      if (rows.length >= 100) return rows
    } catch { /* próximo */ }
  }
  return []
}

// NUPL e MVRV consomem a mesma série; sem esse cache de promise em andamento,
// a segunda chamada (disparada poucos segundos depois) refaz toda a cadeia de
// fetch + proxies de fallback em paralelo, dobrando o tempo de carregamento.
async function fetchNuplRows(): Promise<CMRow[]> {
  if (cmRowsCache) return cmRowsCache
  if (!cmRowsPromise) {
    cmRowsPromise = fetchNuplRowsUncached().finally(() => { cmRowsPromise = null })
  }
  const rows = await cmRowsPromise
  if (rows.length >= 100) cmRowsCache = rows
  return rows
}

export async function renderNuplLth(canvas: HTMLCanvasElement): Promise<NuplResult> {
  let labels:    string[]
  let nuplVals:  number[]
  let priceVals: number[]

  const cmRows = await fetchNuplRows()

  if (cmRows.length >= 100) {
    // ── CoinMetrics: NUPL real (MarketCap - RealizedCap) / MarketCap ─────────
    labels    = cmRows.map(d =>
      new Date(d.time).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    )
    nuplVals  = cmRows.map(d => {
      const mkt  = parseFloat(d.CapMrktCurUSD!)
      const real = parseFloat(d.CapRealUSD!)
      return parseFloat(((mkt - real) / mkt).toFixed(4))
    })
    priceVals = cmRows.map(d => (d.PriceUSD ? parseFloat(d.PriceUSD) : NaN))
  } else {
    // ── Fallback: aproximação pela média móvel de 200 semanas ─────────────────
    const raw    = await fetchBtcHistory()
    const prices = raw.map(d => d.price)
    const WMA    = 1400  // 200 semanas ≈ custo médio de holders de longo prazo

    labels    = []
    nuplVals  = []
    priceVals = []

    for (let i = WMA - 1; i < raw.length; i++) {
      let sum = 0
      for (let k = i - WMA + 1; k <= i; k++) sum += prices[k]
      const wma  = sum / WMA
      const p    = prices[i]
      labels.push(new Date(raw[i].time).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }))
      nuplVals.push(parseFloat(((p - wma) / p).toFixed(4)))
      priceVals.push(p)
    }
  }

  if (nuplVals.length < 100) throw new Error('Dados NUPL insuficientes')


  const lastNupl  = nuplVals[nuplVals.length - 1]
  const lastPhase = nuplPhaseInfo(lastNupl)

  nuplChart = destroy(nuplChart)
  nuplChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          type: 'line' as const,
          label: 'NUPL',
          data: nuplVals,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          segment: { borderColor: (ctx: any) => nuplPhaseInfo(nuplVals[ctx.p1DataIndex] ?? 0).color } as never,
          borderColor: lastPhase.color,
          borderWidth: 1.8,
          fill: false,
          tension: 0.2,
          pointRadius: 0,
          yAxisID: 'yNupl',
          order: 1,
        },
        {
          type: 'line' as const,
          label: 'BTC Price',
          data: priceVals,
          borderColor: '#e6edf344',
          borderWidth: 1,
          fill: false,
          tension: 0.15,
          pointRadius: 0,
          yAxisID: 'yPrice',
          order: 2,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index' as const, intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2128',
          borderColor: '#30363d',
          borderWidth: 1,
          titleColor: '#8b949e',
          bodyColor: '#e6edf3',
          padding: 10,
          callbacks: {
            title: items => items[0]?.label ?? '',
            label: ctx => {
              if (ctx.datasetIndex === 0) {
                const v = ctx.parsed.y ?? 0
                return `NUPL: ${v.toFixed(3)} — ${nuplPhaseInfo(v).label}`
              }
              const p = ctx.parsed.y ?? 0
              return `BTC: $${p.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
            },
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        zoom: ZOOM_OPTS as any,
      },
      scales: {
        x: { ...XAXIS, ticks: { ...XAXIS.ticks, maxTicksLimit: 10 } },
        yNupl: {
          position: 'left' as const,
          ticks: { color: '#8b949e', callback: v => Number(v).toFixed(2) },
          grid: { color: GRID },
        },
        yPrice: {
          position: 'right' as const,
          type: 'logarithmic' as const,
          ticks: {
            color: '#8b949e',
            callback: v => '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }),
            maxTicksLimit: 6,
          },
          grid: { drawOnChartArea: false },
        },
      },
    },
    plugins: [nuplZonesPlugin],
  })
  enableZoomReset(nuplChart)

  return { nupl: lastNupl, phase: lastPhase.label, color: lastPhase.color }
}

// ─── MVRV Ratio ───────────────────────────────────────────────────────────────

export interface MvrvResult {
  mvrv:  number
  phase: string
  color: string
}

const MVRV_PHASES = [
  { min: -Infinity, label: 'Capitulation', color: '#3b82f6' },
  { min: 1,         label: 'Accumulation', color: '#22d3ee' },
  { min: 2,         label: 'Bull Market',  color: '#3fb950' },
  { min: 3.5,       label: 'Overvalued',   color: '#e6b450' },
  { min: 5.5,       label: 'Market Top',   color: '#f85149' },
] as const

function mvrvPhaseInfo(v: number): { label: string; color: string } {
  for (let i = MVRV_PHASES.length - 1; i >= 0; i--) {
    if (v >= MVRV_PHASES[i].min) return MVRV_PHASES[i]
  }
  return MVRV_PHASES[0]
}

const mvrvZonesPlugin = {
  id: 'mvrvZones',
  beforeDatasetsDraw(chart: Chart) {
    const { ctx, chartArea, scales } = chart
    const y = scales['yMvrv']
    if (!chartArea || !y) return

    const zones = [
      { from: -Infinity, to: 1,        fill: '#3b82f614' },
      { from: 1,         to: 2,        fill: '#22d3ee14' },
      { from: 2,         to: 3.5,      fill: '#3fb95014' },
      { from: 3.5,       to: 5.5,      fill: '#e6b45014' },
      { from: 5.5,       to: Infinity, fill: '#f8514914' },
    ]

    ctx.save()
    ctx.beginPath()
    ctx.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height)
    ctx.clip()

    for (const zone of zones) {
      const top    = y.getPixelForValue(Math.min(zone.to,   y.max))
      const bottom = y.getPixelForValue(Math.max(zone.from, y.min))
      ctx.fillStyle = zone.fill
      ctx.fillRect(chartArea.left, top, chartArea.width, bottom - top)
    }

    const y1 = y.getPixelForValue(1)
    if (y1 >= chartArea.top && y1 <= chartArea.bottom) {
      ctx.strokeStyle = '#ffffff33'
      ctx.lineWidth   = 1
      ctx.setLineDash([5, 5])
      ctx.beginPath()
      ctx.moveTo(chartArea.left, y1)
      ctx.lineTo(chartArea.right, y1)
      ctx.stroke()
      ctx.setLineDash([])
    }

    ctx.restore()
  },
}

export async function renderMvrvRatio(canvas: HTMLCanvasElement): Promise<MvrvResult> {
  let labels:    string[]
  let mvrvVals:  number[]
  let priceVals: number[]

  const cmRows = await fetchNuplRows()

  if (cmRows.length >= 100) {
    labels    = cmRows.map(d =>
      new Date(d.time).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    )
    mvrvVals  = cmRows.map(d => {
      const mkt  = parseFloat(d.CapMrktCurUSD!)
      const real = parseFloat(d.CapRealUSD!)
      return parseFloat((mkt / real).toFixed(4))
    })
    priceVals = cmRows.map(d => (d.PriceUSD ? parseFloat(d.PriceUSD) : NaN))
  } else {
    // fallback: MVRV ≈ Preço / SMA 200 semanas
    const raw    = await fetchBtcHistory()
    const prices = raw.map(d => d.price)
    const WMA    = 1400

    labels    = []
    mvrvVals  = []
    priceVals = []

    for (let i = WMA - 1; i < raw.length; i++) {
      let sum = 0
      for (let k = i - WMA + 1; k <= i; k++) sum += prices[k]
      const wma = sum / WMA
      const p   = prices[i]
      labels.push(new Date(raw[i].time).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }))
      mvrvVals.push(parseFloat((p / wma).toFixed(4)))
      priceVals.push(p)
    }
  }

  if (mvrvVals.length < 100) throw new Error('Dados MVRV insuficientes')

  const lastMvrv  = mvrvVals[mvrvVals.length - 1]
  const lastPhase = mvrvPhaseInfo(lastMvrv)

  mvrvChart = destroy(mvrvChart)
  mvrvChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          type: 'line' as const,
          label: 'MVRV',
          data: mvrvVals,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          segment: { borderColor: (ctx: any) => mvrvPhaseInfo(mvrvVals[ctx.p1DataIndex] ?? 0).color } as never,
          borderColor: lastPhase.color,
          borderWidth: 1.8,
          fill: false,
          tension: 0.2,
          pointRadius: 0,
          yAxisID: 'yMvrv',
          order: 1,
        },
        {
          type: 'line' as const,
          label: 'BTC Price',
          data: priceVals,
          borderColor: '#e6edf344',
          borderWidth: 1,
          fill: false,
          tension: 0.15,
          pointRadius: 0,
          yAxisID: 'yPrice',
          order: 2,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index' as const, intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2128',
          borderColor: '#30363d',
          borderWidth: 1,
          titleColor: '#8b949e',
          bodyColor: '#e6edf3',
          padding: 10,
          callbacks: {
            title: items => items[0]?.label ?? '',
            label: ctx => {
              if (ctx.datasetIndex === 0) {
                const v = ctx.parsed.y ?? 0
                return `MVRV: ${v.toFixed(3)}× — ${mvrvPhaseInfo(v).label}`
              }
              const p = ctx.parsed.y ?? 0
              return `BTC: $${p.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
            },
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        zoom: ZOOM_OPTS as any,
      },
      scales: {
        x: { ...XAXIS, ticks: { ...XAXIS.ticks, maxTicksLimit: 10 } },
        yMvrv: {
          position: 'left' as const,
          min: 0,
          ticks: { color: '#8b949e', callback: v => Number(v).toFixed(1) + '×' },
          grid: { color: GRID },
        },
        yPrice: {
          position: 'right' as const,
          type: 'logarithmic' as const,
          ticks: {
            color: '#8b949e',
            callback: v => '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }),
            maxTicksLimit: 6,
          },
          grid: { drawOnChartArea: false },
        },
      },
    },
    plugins: [mvrvZonesPlugin],
  })
  enableZoomReset(mvrvChart)

  return { mvrv: lastMvrv, phase: lastPhase.label, color: lastPhase.color }
}

// ─── Drawdown Risk (aproximação via MVRV Z-Score) ─────────────────────────────
// Não é o indicador proprietário "Drawdown Risk V3" (Wantage Node/TradingView) —
// aproximação própria: MVRV Z-Score suavizado, convertido em percentil histórico
// (0-100). Maioria dos dias fica "grudada" nas faixas baixas (mercado normal) e
// só sobe pra zona de risco nas raras janelas de euforia — mesmo formato visual
// de platô do original, mas com dados reais de CoinMetrics.

export interface DrawdownRiskResult {
  risk:  number
  phase: string
  color: string
}

let riskChart: Chart | null = null

const RISK_PHASES = [
  { min: -Infinity, label: 'Risco baixo',    color: '#3fb950' },
  { min: 60,         label: 'Risco moderado', color: '#e6b450' },
  { min: 85,         label: 'Risco alto',     color: '#f85149' },
] as const

function riskPhaseInfo(v: number): { label: string; color: string } {
  for (let i = RISK_PHASES.length - 1; i >= 0; i--) {
    if (v >= RISK_PHASES[i].min) return RISK_PHASES[i]
  }
  return RISK_PHASES[0]
}

const riskZonesPlugin = {
  id: 'riskZones',
  beforeDatasetsDraw(chart: Chart) {
    const { ctx, chartArea, scales } = chart
    const y = scales['yRisk']
    if (!chartArea || !y) return

    const zones = [
      { from: 0,  to: 60,  fill: '#3fb95014' },
      { from: 60, to: 85,  fill: '#e6b45014' },
      { from: 85, to: 100, fill: '#f8514914' },
    ]

    ctx.save()
    ctx.beginPath()
    ctx.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height)
    ctx.clip()

    for (const zone of zones) {
      const top    = y.getPixelForValue(zone.to)
      const bottom = y.getPixelForValue(zone.from)
      ctx.fillStyle = zone.fill
      ctx.fillRect(chartArea.left, top, chartArea.width, bottom - top)
    }

    ctx.restore()
  },
}

/** Suaviza ruído diário antes do ranking — reduz o serrilhado da linha */
function smooth(vals: number[], window: number): number[] {
  return vals.map((_, i) => {
    const from = Math.max(0, i - window + 1)
    const slice = vals.slice(from, i + 1).filter(v => Number.isFinite(v))
    if (!slice.length) return NaN
    return slice.reduce((s, v) => s + v, 0) / slice.length
  })
}

/** Converte cada valor no seu percentil histórico (0-100) — a maioria dos dias
 * historicamente "normais" fica grudada nas faixas baixas, só as raras leituras
 * mais extremas (euforia) sobem para o topo da escala. */
function percentileNormalize(vals: number[]): number[] {
  const finite = vals.filter(v => Number.isFinite(v)).sort((a, b) => a - b)
  if (!finite.length) return vals.map(() => NaN)
  return vals.map(v => {
    if (!Number.isFinite(v)) return NaN
    let lo = 0, hi = finite.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (finite[mid] < v) lo = mid + 1; else hi = mid
    }
    return (lo / finite.length) * 100
  })
}

export async function renderDrawdownRisk(canvas: HTMLCanvasElement): Promise<DrawdownRiskResult> {
  let labels:    string[]
  let zScores:   number[]
  let priceVals: number[]

  const cmRows = await fetchNuplRows()

  if (cmRows.length >= 100) {
    labels = cmRows.map(d =>
      new Date(d.time).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    )
    const mktVals  = cmRows.map(d => parseFloat(d.CapMrktCurUSD!))
    const realVals = cmRows.map(d => parseFloat(d.CapRealUSD!))
    priceVals = cmRows.map(d => (d.PriceUSD ? parseFloat(d.PriceUSD) : NaN))

    const mean   = mktVals.reduce((s, v) => s + v, 0) / mktVals.length
    const stdDev = Math.sqrt(mktVals.reduce((s, v) => s + (v - mean) ** 2, 0) / mktVals.length)

    zScores = mktVals.map((m, i) => (stdDev > 0 ? (m - realVals[i]) / stdDev : NaN))
  } else {
    // fallback: z-score de (preço - SMA 200 semanas) sobre desvio-padrão do preço
    const raw    = await fetchBtcHistory()
    const prices = raw.map(d => d.price)
    const WMA    = 1400

    labels    = []
    priceVals = []
    const diffs: number[] = []

    for (let i = WMA - 1; i < raw.length; i++) {
      let sum = 0; for (let k = i - WMA + 1; k <= i; k++) sum += prices[k]
      const wma = sum / WMA
      labels.push(new Date(raw[i].time).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }))
      priceVals.push(prices[i])
      diffs.push(prices[i] - wma)
    }

    const mean   = diffs.reduce((s, v) => s + v, 0) / diffs.length
    const stdDev = Math.sqrt(diffs.reduce((s, v) => s + (v - mean) ** 2, 0) / diffs.length)
    zScores = diffs.map(d => (stdDev > 0 ? d / stdDev : NaN))
  }

  if (zScores.length < 100) throw new Error('Dados insuficientes')

  const riskVals  = percentileNormalize(smooth(zScores, 14))
  const lastRisk  = riskVals[riskVals.length - 1]
  const lastPhase = riskPhaseInfo(lastRisk)

  riskChart = destroy(riskChart)
  riskChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          type: 'line' as const,
          label: 'Drawdown Risk',
          data: riskVals,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          segment: { borderColor: (ctx: any) => riskPhaseInfo(riskVals[ctx.p1DataIndex] ?? 0).color } as never,
          borderColor: lastPhase.color,
          borderWidth: 1.8,
          fill: false,
          tension: 0.2,
          pointRadius: 0,
          yAxisID: 'yRisk',
          order: 1,
          spanGaps: true,
        },
        {
          type: 'line' as const,
          label: 'BTC Price',
          data: priceVals,
          borderColor: '#e6edf344',
          borderWidth: 1,
          fill: false,
          tension: 0.15,
          pointRadius: 0,
          yAxisID: 'yPrice',
          order: 2,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index' as const, intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2128',
          borderColor: '#30363d',
          borderWidth: 1,
          titleColor: '#8b949e',
          bodyColor: '#e6edf3',
          padding: 10,
          callbacks: {
            title: items => items[0]?.label ?? '',
            label: ctx => {
              if (ctx.datasetIndex === 0) {
                const v = ctx.parsed.y ?? 0
                return `Risco: ${v.toFixed(1)} — ${riskPhaseInfo(v).label}`
              }
              const p = ctx.parsed.y ?? 0
              return `BTC: $${p.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
            },
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        zoom: ZOOM_OPTS as any,
      },
      scales: {
        x: { ...XAXIS, ticks: { ...XAXIS.ticks, maxTicksLimit: 10 } },
        yRisk: {
          position: 'left' as const,
          min: 0,
          max: 100,
          ticks: { color: '#8b949e', callback: v => Number(v).toFixed(0) },
          grid: { color: GRID },
        },
        yPrice: {
          position: 'right' as const,
          type: 'logarithmic' as const,
          ticks: {
            color: '#8b949e',
            callback: v => '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }),
            maxTicksLimit: 6,
          },
          grid: { drawOnChartArea: false },
        },
      },
    },
    plugins: [riskZonesPlugin],
  })
  enableZoomReset(riskChart)

  return { risk: lastRisk, phase: lastPhase.label, color: lastPhase.color }
}

// ─── Realized P/L (aproximado por faixa etária) ───────────────────────────────

interface OHLCVRow { time: number; close: number; volume: number }

async function fetchBtcDailyOHLCV(limit: number): Promise<OHLCVRow[]> {
  // Binance daily candles — mesma fonte já usada no Liquidation Heatmap, sem problemas de CORS
  const candles = await fetchCandles('BTCUSDT', '1d', Math.min(limit, 1000))
  return candles.map(c => ({ time: c.time, close: c.close, volume: c.volume }))
}

function rollingMean(arr: number[], n: number): number[] {
  return arr.map((_, i) => {
    if (i < n - 1) return NaN
    let s = 0; for (let k = i - n + 1; k <= i; k++) s += arr[k]
    return s / n
  })
}

let rplChart: Chart | null = null

// Bandas: fração de volume × (preço atual - SMA do período) = P/L estimado em USD
const RPL_BANDS = [
  { label: '< 1 sem',       smaLen:   7, frac: 0.28, colorPos: '#f8514999', colorNeg: '#f8514977' },
  { label: '1 sem – 1 mês', smaLen:  30, frac: 0.25, colorPos: '#e6855a99', colorNeg: '#e6855a77' },
  { label: '1 – 3 meses',   smaLen:  90, frac: 0.22, colorPos: '#e6b45099', colorNeg: '#e6b45077' },
  { label: '3 meses – 1a',  smaLen: 200, frac: 0.15, colorPos: '#3fb95099', colorNeg: '#3fb95077' },
  { label: '> 1 ano',       smaLen: 365, frac: 0.10, colorPos: '#36d39999', colorNeg: '#36d39977' },
] as const

export async function renderRealizedPL(
  canvas: HTMLCanvasElement,
  days = 365,
): Promise<void> {
  const limit = Math.min(days + 400, 2000)  // extra history for longer SMAs
  const rows  = await fetchBtcDailyOHLCV(limit)
  if (rows.length < 50) throw new Error('Dados insuficientes')

  const closes = rows.map(d => d.close)
  const vols   = rows.map(d => d.volume)

  // Pre-compute all SMAs
  const smas = RPL_BANDS.map(b => rollingMean(closes, b.smaLen))

  // Slice to requested days
  const start = Math.max(rows.length - days, 0)
  const slicedRows  = rows.slice(start)
  const slicedVols  = vols.slice(start)
  const slicedSmas  = smas.map(s => s.slice(start))
  const slicedClose = closes.slice(start)

  const labels = slicedRows.map(d =>
    new Date(d.time).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  )

  const SCALE = 1e9  // → bilhões USD

  const bandDatasets = RPL_BANDS.map((band, bi) => {
    const smaSlice = slicedSmas[bi]
    const data = slicedClose.map((p, i) =>
      isNaN(smaSlice[i]) ? NaN : parseFloat(((p - smaSlice[i]) * slicedVols[i] * band.frac / SCALE).toFixed(4))
    )
    return {
      type:            'bar' as const,
      label:           band.label,
      data,
      backgroundColor: data.map(v => ((v ?? 0) >= 0 ? band.colorPos : band.colorNeg)),
      borderWidth:     0,
      stack:           'rpl',
      yAxisID:         'yPL',
      order:           RPL_BANDS.length - bi,
      barPercentage:   1.0,
      categoryPercentage: 1.0,
    }
  })

  rplChart = destroy(rplChart)
  rplChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        ...bandDatasets,
        {
          type:        'line' as const,
          label:       'Preço BTC',
          data:        slicedClose,
          borderColor: '#e6edf355',
          borderWidth: 1.5,
          fill:        false,
          tension:     0.2,
          pointRadius: 0,
          yAxisID:     'yPrice',
          order:       0,
          spanGaps:    true,
        },
      ],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation:           false,
      interaction:         { mode: 'index' as const, intersect: false },
      plugins: {
        legend: {
          display:  true,
          position: 'top' as const,
          labels:   { color: '#8b949e', font: { size: 11 }, boxWidth: 12, padding: 14 },
        },
        tooltip: {
          backgroundColor: '#1c2128',
          borderColor:     '#30363d',
          borderWidth:     1,
          titleColor:      '#8b949e',
          bodyColor:       '#e6edf3',
          padding:         10,
          filter:          item => item.parsed.y !== 0 && !isNaN(item.parsed.y ?? NaN),
          callbacks: {
            title: items => items[0]?.label ?? '',
            label: ctx => {
              if (ctx.dataset.label === 'Preço BTC') {
                const p = ctx.parsed.y ?? 0
                return `BTC: $${p.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
              }
              const v = ctx.parsed.y ?? 0
              const sign = v >= 0 ? '+' : ''
              return `${ctx.dataset.label}: ${sign}$${v.toFixed(3)}B`
            },
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        zoom: ZOOM_OPTS as any,
      },
      scales: {
        x: {
          ...XAXIS,
          stacked: true,
          ticks: { ...XAXIS.ticks, maxTicksLimit: 10 },
        },
        yPL: {
          position: 'left' as const,
          stacked:  true,
          ticks: {
            color:    '#8b949e',
            callback: v => {
              const n = Number(v)
              return (n >= 0 ? '+' : '') + '$' + Math.abs(n).toFixed(1) + 'B'
            },
          },
          grid: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            color: (ctx: any) => ctx.tick.value === 0 ? '#ffffff44' : GRID,
          },
        },
        yPrice: {
          position: 'right' as const,
          type:     'logarithmic' as const,
          ticks: {
            color:        '#8b949e',
            maxTicksLimit: 5,
            callback:     v => '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }),
          },
          grid: { drawOnChartArea: false },
        },
      },
    },
  })
  enableZoomReset(rplChart)
}

/** Atualiza os últimos pontos de BTC/ETH/SOL com preços ao vivo */
export function tickComparisonChart(prices: Partial<Record<'BTC' | 'ETH' | 'SOL', number>>): void {
  if (!compChart) return
  let updated = false
  for (const [sym, idx] of [['BTC', 0], ['ETH', 1], ['SOL', 2]] as const) {
    const live = prices[sym]
    const base = compBase[sym]
    if (live && base) {
      setLast(compChart, idx, parseFloat((live / base * 100).toFixed(4)))
      updated = true
    }
  }
  if (updated) compChart.update('none')
}

// ─── Preço do Petróleo (Brent) ───────────────────────────────────────────────────
// Fonte: Pyth Network Benchmarks (TradingView-compatible history shim),
// feed "Commodities.UKOILSPOT" (Brent spot) — sem necessidade de proxy/CORS.

interface OilRow { time: number; close: number }

async function fetchOilHistory(days: number): Promise<OilRow[]> {
  const to   = Math.floor(Date.now() / 1000)
  const from = to - Math.min(days, 364) * 86400
  const url  = `https://benchmarks.pyth.network/v1/shims/tradingview/history?symbol=Commodities.UKOILSPOT&resolution=D&from=${from}&to=${to}`

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Pyth HTTP ${res.status}`)
  const d: { s: string; t: number[]; c: number[] } = await res.json()
  if (d.s !== 'ok' || !d.t?.length) throw new Error('Dados de petróleo indisponíveis')

  return d.t.map((t, i) => ({ time: t * 1000, close: d.c[i] }))
}

let oilChart: Chart | null = null

export async function renderOilPrice(canvas: HTMLCanvasElement): Promise<{ price: number }> {
  const rows = await fetchOilHistory(365)

  const labels = rows.map(r => dateFmt(r.time, false))
  const prices = rows.map(r => r.close)
  const lastPrice = prices[prices.length - 1]

  oilChart = destroy(oilChart)
  oilChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Brent (US$/barril)',
          data: prices,
          borderColor: '#e6b450',
          backgroundColor: '#e6b45018',
          fill: true,
          tension: 0.2,
          borderWidth: 1.8,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2128',
          borderColor: '#30363d',
          borderWidth: 1,
          titleColor: '#8b949e',
          bodyColor: '#e6edf3',
          padding: 10,
          callbacks: {
            label: ctx => `Brent: $${(ctx.parsed.y ?? 0).toFixed(2)}`,
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        zoom: ZOOM_OPTS as any,
      },
      scales: {
        x: { ...XAXIS, ticks: { ...XAXIS.ticks, maxTicksLimit: 10 } },
        y: {
          ...YAXIS,
          ticks: { ...YAXIS.ticks, callback: v => '$' + Number(v).toFixed(0) },
        },
      },
    },
    plugins: [lastPricePlugin],
  })
  enableZoomReset(oilChart)

  return { price: lastPrice }
}

// ─── Trader Flow (Money Flow Index) ───────────────────────────────────────────
// Aproximação do indicador "Trader Flow" (VantageNode) — Money Flow Index (14) sobre
// candles diários do BTC: mede a pressão de compra/venda combinando preço típico e
// volume. Verde = zona de desconto (sobrevenda), vermelho = zona de sobrecompra,
// branco = neutro — mesma leitura visual do indicador original, com dados da Binance.

export interface TraderFlowResult {
  value:   number
  phase:   string
  color:   string
  pctLow:  number
  pctMid:  number
  pctHigh: number
}

const FLOW_UPPER = 80
const FLOW_LOWER = 20

const FLOW_PHASES = [
  { max: FLOW_LOWER, label: 'Descontado',    color: '#3fb950' },
  { max: FLOW_UPPER,  label: 'Neutro',       color: '#e6edf3' },
  { max: Infinity,    label: 'Sobrecomprado', color: '#f85149' },
] as const

function flowPhaseInfo(v: number): { label: string; color: string } {
  for (const p of FLOW_PHASES) if (v <= p.max) return p
  return FLOW_PHASES[FLOW_PHASES.length - 1]
}

/** Money Flow Index: RSI ponderado por volume, usando preço típico (H+L+C)/3 */
function moneyFlowIndex(candles: Candle[], period = 14): number[] {
  const n       = candles.length
  const typical = candles.map(c => (c.high + c.low + c.close) / 3)
  const rawFlow = typical.map((tp, i) => tp * candles[i].volume)

  const mfi: number[] = new Array(n).fill(NaN)
  for (let i = period; i < n; i++) {
    let pos = 0, neg = 0
    for (let k = i - period + 1; k <= i; k++) {
      if (typical[k] > typical[k - 1]) pos += rawFlow[k]
      else if (typical[k] < typical[k - 1]) neg += rawFlow[k]
    }
    mfi[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg)
  }
  return mfi
}

let flowChart: Chart | null = null

const flowZonesPlugin = {
  id: 'flowZones',
  afterDraw(chart: Chart) {
    const { ctx, chartArea, scales } = chart
    const y = scales['yFlow']
    if (!chartArea || !y) return

    const lines = [
      { value: FLOW_UPPER, color: '#f85149' },
      { value: FLOW_LOWER, color: '#3fb950' },
    ]

    ctx.save()
    ctx.setLineDash([5, 4])
    ctx.lineWidth = 1
    for (const line of lines) {
      const py = y.getPixelForValue(line.value)
      ctx.strokeStyle = line.color
      ctx.beginPath()
      ctx.moveTo(chartArea.left, py)
      ctx.lineTo(chartArea.right, py)
      ctx.stroke()
    }
    ctx.restore()
  },
}

/** Busca candles diários do BTC, paginando quando o período pedido excede o limite
 * de 1000 velas por requisição da Binance (necessário para 5a / All). */
async function fetchBtcCandlesRange(days: number | 'all'): Promise<Candle[]> {
  const WARMUP = 20  // folga para o warm-up do MFI (14 períodos)

  if (days !== 'all' && days + WARMUP <= 1000) {
    return fetchCandles('BTCUSDT', '1d', days + WARMUP)
  }

  const DAY_MS = 86_400_000
  const all: Candle[] = []
  let startTime = days === 'all'
    ? new Date('2017-08-17').getTime()
    : Date.now() - (days + WARMUP) * DAY_MS

  while (startTime < Date.now()) {
    const batch = await fetchCandles('BTCUSDT', '1d', 1000, startTime)
    if (!batch.length) break
    all.push(...batch)
    if (batch.length < 1000) break
    startTime = batch[batch.length - 1].time + DAY_MS
  }
  return all
}

export async function renderTraderFlow(canvas: HTMLCanvasElement, days: number | 'all' = 365): Promise<TraderFlowResult> {
  const candles = await fetchBtcCandlesRange(days)
  if (candles.length < 30) throw new Error('Dados insuficientes')

  const mfiFull = moneyFlowIndex(candles, 14)

  const start     = days === 'all' ? 14 : Math.max(candles.length - days, 0)
  const rows      = candles.slice(start)
  const flowVals  = mfiFull.slice(start)
  const priceVals = rows.map(c => c.close)
  const labels    = rows.map(c => new Date(c.time).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }))

  const lastFlow  = [...flowVals].reverse().find(Number.isFinite) ?? NaN
  const lastPhase = flowPhaseInfo(lastFlow)

  const finite  = flowVals.filter(Number.isFinite)
  const pctLow  = finite.length ? (finite.filter(v => v <= FLOW_LOWER).length  / finite.length) * 100 : 0
  const pctHigh = finite.length ? (finite.filter(v => v >= FLOW_UPPER).length  / finite.length) * 100 : 0
  const pctMid  = Math.max(0, 100 - pctLow - pctHigh)

  flowChart = destroy(flowChart)
  flowChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          type: 'line' as const,
          label: 'Trader Flow',
          data: flowVals,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          segment: { borderColor: (ctx: any) => flowPhaseInfo(flowVals[ctx.p1DataIndex] ?? 50).color } as never,
          borderColor: lastPhase.color,
          borderWidth: 1.6,
          fill: false,
          tension: 0.25,
          pointRadius: 0,
          yAxisID: 'yFlow',
          order: 1,
          spanGaps: true,
        },
        {
          type: 'line' as const,
          label: 'BTC Price',
          data: priceVals,
          borderColor: '#e6edf333',
          borderWidth: 1,
          fill: false,
          tension: 0.15,
          pointRadius: 0,
          yAxisID: 'yPrice',
          order: 2,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index' as const, intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1c2128',
          borderColor: '#30363d',
          borderWidth: 1,
          titleColor: '#8b949e',
          bodyColor: '#e6edf3',
          padding: 10,
          callbacks: {
            title: items => items[0]?.label ?? '',
            label: ctx => {
              if (ctx.datasetIndex === 0) {
                const v = ctx.parsed.y ?? 0
                return `Trader Flow: ${v.toFixed(1)} — ${flowPhaseInfo(v).label}`
              }
              const p = ctx.parsed.y ?? 0
              return `BTC: $${p.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
            },
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        zoom: ZOOM_OPTS as any,
      },
      scales: {
        x: { ...XAXIS, ticks: { ...XAXIS.ticks, maxTicksLimit: 10 } },
        yFlow: {
          position: 'left' as const,
          min: 0,
          max: 100,
          ticks: { color: '#8b949e', callback: v => Number(v).toFixed(0) },
          grid: { color: GRID },
        },
        yPrice: {
          position: 'right' as const,
          type: 'logarithmic' as const,
          ticks: {
            color: '#8b949e',
            callback: v => '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }),
            maxTicksLimit: 6,
          },
          grid: { drawOnChartArea: false },
        },
      },
    },
    plugins: [flowZonesPlugin],
  })
  enableZoomReset(flowChart)

  return { value: lastFlow, phase: lastPhase.label, color: lastPhase.color, pctLow, pctMid, pctHigh }
}
