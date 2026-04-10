import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  TimeScale,
  Filler,
  Legend,
  Tooltip,
} from 'chart.js'
import zoomPlugin from 'chartjs-plugin-zoom'
import type { Kline } from './types'
import { fetchKlines } from './binance'

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, TimeScale, Filler, Legend, Tooltip, zoomPlugin)

// ─── helpers ─────────────────────────────────────────────────────────────────

const GRID  = '#21262d'
const XAXIS = { ticks: { color: '#8b949e' as const }, grid: { color: GRID } }
const YAXIS = { ticks: { color: '#8b949e' as const }, grid: { color: GRID } }

function destroy(ref: Chart | null): null {
  ref?.destroy()
  return null
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
      plugins: { legend: { display: false } },
      scales: {
        x: { ...XAXIS, ticks: { ...XAXIS.ticks, maxTicksLimit: 8 } },
        y: { ...YAXIS, ticks: { ...YAXIS.ticks, callback: v => '$' + Number(v).toLocaleString('en-US') } },
      },
    },
    plugins: [lastPricePlugin],
  })
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
      plugins: {
        legend: { labels: { color: '#e6edf3' } },
        tooltip: { callbacks: { label: c => c.dataset.label!.split(' (')[0] + ': $' + (c.parsed.y ?? 0).toFixed(1) + 'k' } },
      },
      scales: {
        x: XAXIS,
        y: { ...YAXIS, ticks: { ...YAXIS.ticks, callback: v => '$' + v + 'k' } },
      },
    },
    plugins: [liveDotsPlugin],
  })
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
        zoom: {
          pan:  { enabled: true,  mode: 'x', threshold: 5 },
          zoom: {
            wheel:  { enabled: true },
            pinch:  { enabled: true },
            mode:   'x',
          },
          limits: { x: { minRange: 5 } },
        },
      },
      scales: {
        x: { ...XAXIS, ticks: { ...XAXIS.ticks, maxTicksLimit: 10 } },
        y: { ...YAXIS, ticks: { ...YAXIS.ticks, callback: v => Number(v).toFixed(0) } },
      },
    },
    plugins: [liveDotsPlugin],
  })
}

/** Reseta o zoom do gráfico de comparação */
export function resetComparisonZoom(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(compChart as any)?.resetZoom()
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
