import { fetchCandles } from './binance'

// Color ramp: 0 = dark blue, 1 = yellow-green
const STOPS: [number, [number, number, number]][] = [
  [0.00, [  1,  10,  25]],
  [0.12, [  4,  47, 120]],
  [0.28, [  0, 100, 180]],
  [0.48, [  0, 188, 212]],
  [0.70, [  0, 230, 255]],
  [0.86, [105, 240,  80]],
  [1.00, [250, 255,   0]],
]

function lerpRGB(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t))
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [t0, c0] = STOPS[i]
    const [t1, c1] = STOPS[i + 1]
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0)
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ]
    }
  }
  return STOPS[STOPS.length - 1][1]
}

export async function renderLiquidationHeatmap(
  canvas: HTMLCanvasElement,
  days = 90,
): Promise<{ currentPrice: number }> {
  const candles = await fetchCandles('BTCUSDT', '4h', Math.min(days * 6, 1000))
  if (candles.length < 10) throw new Error('Dados insuficientes')

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas context indisponível')

  // Size canvas to match its CSS container, accounting for chart-wrap padding
  const container = canvas.parentElement as HTMLElement
  const PAD = 16
  const W   = Math.max(container.clientWidth  - PAD * 2, 300)
  const H   = Math.max(container.clientHeight - PAD * 2, 200)
  const DPR = window.devicePixelRatio || 1

  canvas.width        = W * DPR
  canvas.height       = H * DPR
  canvas.style.width  = W + 'px'
  canvas.style.height = H + 'px'
  ctx.scale(DPR, DPR)

  const N  = candles.length
  const PB = 300  // vertical price buckets

  const priceMin = Math.min(...candles.map(c => c.low))  * 0.993
  const priceMax = Math.max(...candles.map(c => c.high)) * 1.007

  // Build volume-weighted density, recent candles weighted higher (decay)
  const DECAY   = 0.996
  const density = new Float32Array(PB)

  for (let i = 0; i < N; i++) {
    const c      = candles[i]
    const weight = Math.pow(DECAY, N - 1 - i)  // 1.0 for newest, decays older
    const bLo    = Math.max(0,  Math.floor((c.low  - priceMin) / (priceMax - priceMin) * PB))
    const bHi    = Math.min(PB, Math.ceil( (c.high - priceMin) / (priceMax - priceMin) * PB))
    const spread = Math.max(bHi - bLo, 1)
    for (let b = bLo; b < bHi; b++) density[b] += (c.volume * weight) / spread
  }

  // Gaussian vertical smooth (σ = 1.8 buckets) — sharp enough to keep distinct bands
  const smoothed = new Float32Array(PB)
  const SIGMA = 1.8
  const KRAD  = Math.ceil(SIGMA * 3)
  for (let b = 0; b < PB; b++) {
    let sum = 0, wsum = 0
    for (let k = -KRAD; k <= KRAD; k++) {
      const bb = b + k
      if (bb >= 0 && bb < PB) {
        const w = Math.exp(-(k * k) / (2 * SIGMA * SIGMA))
        sum  += density[bb] * w
        wsum += w
      }
    }
    smoothed[b] = sum / wsum
  }

  // Normalize to 95th percentile so outliers don't wash out mid-range values
  const vals = Array.from(smoothed).filter(v => v > 0).sort((a, b) => a - b)
  const p95  = vals[Math.floor(vals.length * 0.95)] || 1

  // ── Layout margins ─────────────────────────────────────────────────────────
  const ML = 66, MR = 8, MT = 10, MB = 22
  const cW = W - ML - MR
  const cH = H - MT - MB

  // Background
  ctx.fillStyle = '#0d1117'
  ctx.fillRect(0, 0, W, H)

  // ── Heatmap bands ──────────────────────────────────────────────────────────
  const bandH = cH / PB

  for (let b = 0; b < PB; b++) {
    const intensity = Math.min(smoothed[b] / p95, 1)
    if (intensity < 0.03) continue
    const [r, g, bl] = lerpRGB(intensity)
    const alpha = Math.min(0.10 + intensity * 0.90, 1)
    ctx.fillStyle = `rgba(${r},${g},${bl},${alpha})`
    const y = MT + cH - (b + 1) * bandH
    ctx.fillRect(ML, y, cW, Math.max(bandH, 1.2))
  }

  // ── Subtle horizontal grid lines ───────────────────────────────────────────
  const TICKS = 6
  ctx.strokeStyle = '#21262d'
  ctx.lineWidth   = 1
  for (let i = 0; i <= TICKS; i++) {
    const p = priceMin + (priceMax - priceMin) * (i / TICKS)
    const y = MT + cH - ((p - priceMin) / (priceMax - priceMin)) * cH
    if (y < MT + 4 || y > H - MB - 4) continue
    ctx.beginPath()
    ctx.moveTo(ML, y)
    ctx.lineTo(W - MR, y)
    ctx.stroke()
  }

  // ── BTC price line ─────────────────────────────────────────────────────────
  const toY = (p: number) => MT + cH - ((p - priceMin) / (priceMax - priceMin)) * cH

  ctx.beginPath()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth   = 1.5
  ctx.lineJoin    = 'round'
  for (let i = 0; i < N; i++) {
    const x = ML + (i / (N - 1)) * cW
    const y = toY(candles[i].close)
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.stroke()

  // ── Current price dashed line + pill label ─────────────────────────────────
  const lastPrice = candles[N - 1].close
  const lastY     = toY(lastPrice)
  const pLabel    = '$' + lastPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })

  ctx.font = '600 11px -apple-system, BlinkMacSystemFont, sans-serif'
  const tw = ctx.measureText(pLabel).width
  const pillW = tw + 14

  ctx.setLineDash([4, 4])
  ctx.strokeStyle = '#e6b450aa'
  ctx.lineWidth   = 1
  ctx.beginPath()
  ctx.moveTo(ML, lastY)
  ctx.lineTo(W - MR - pillW - 4, lastY)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.fillStyle = '#e6b450'
  ctx.beginPath()
  ctx.roundRect(W - MR - pillW, lastY - 9, pillW, 18, 3)
  ctx.fill()
  ctx.fillStyle    = '#0d1117'
  ctx.textBaseline = 'middle'
  ctx.textAlign    = 'left'
  ctx.fillText(pLabel, W - MR - pillW + 7, lastY)

  // ── Y-axis price labels ────────────────────────────────────────────────────
  ctx.fillStyle    = '#6e7681'
  ctx.font         = '10px -apple-system, sans-serif'
  ctx.textAlign    = 'right'
  ctx.textBaseline = 'middle'

  for (let i = 0; i <= TICKS; i++) {
    const p = priceMin + (priceMax - priceMin) * (i / TICKS)
    const y = toY(p)
    if (y < MT + 6 || y > H - MB - 6) continue
    const lbl = p >= 1000
      ? '$' + (p / 1000).toFixed(p >= 10000 ? 0 : 1) + 'k'
      : '$' + p.toFixed(0)
    ctx.fillText(lbl, ML - 5, y)
  }

  // ── X-axis date labels ────────────────────────────────────────────────────
  ctx.fillStyle    = '#6e7681'
  ctx.font         = '10px -apple-system, sans-serif'
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'top'

  const TIME_TICKS = Math.min(7, Math.floor(cW / 80))
  for (let i = 0; i <= TIME_TICKS; i++) {
    const idx  = Math.round((i / TIME_TICKS) * (N - 1))
    const x    = ML + (idx / (N - 1)) * cW
    const date = new Date(candles[idx].time)
    ctx.fillText(
      date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      x,
      H - MB + 4,
    )
  }

  return { currentPrice: lastPrice }
}
