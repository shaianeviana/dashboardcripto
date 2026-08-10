import { fetchCandles, fetchOrderBook } from './binance'

export async function renderOrderBookHeatmap(canvas: HTMLCanvasElement): Promise<{ currentPrice: number }> {
  const [candles, book] = await Promise.all([
    fetchCandles('BTCUSDT', '1h', 168),
    fetchOrderBook('BTCUSDT', 1000),
  ])
  if (candles.length < 10) throw new Error('Dados insuficientes')

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas context indisponível')

  const container = canvas.parentElement as HTMLElement
  const PAD = 16
  const W = Math.max(container.clientWidth - PAD * 2, 300)
  const H = Math.max(container.clientHeight - PAD * 2, 200)
  const DPR = window.devicePixelRatio || 1

  canvas.width        = W * DPR
  canvas.height        = H * DPR
  canvas.style.width  = W + 'px'
  canvas.style.height = H + 'px'
  ctx.scale(DPR, DPR)

  const N = candles.length
  const lastClose = candles[N - 1].close

  const bidsRelevant = book.bids.filter(b => b.price >= lastClose * 0.94)
  const asksRelevant = book.asks.filter(a => a.price <= lastClose * 1.06)

  const priceMin = Math.min(...candles.map(c => c.low),  ...bidsRelevant.map(b => b.price)) * 0.998
  const priceMax = Math.max(...candles.map(c => c.high), ...asksRelevant.map(a => a.price)) * 1.002

  const ML = 66, MR = 64, MT = 10, MB = 22
  const cW = W - ML - MR
  const cH = H - MT - MB

  ctx.fillStyle = '#1D1922'
  ctx.fillRect(0, 0, W, H)

  const toY = (p: number) => MT + cH - ((p - priceMin) / (priceMax - priceMin)) * cH
  const toX = (i: number) => ML + (i / (N - 1)) * cW

  // ── grid horizontal ────────────────────────────────────────────────────────
  const TICKS = 6
  ctx.strokeStyle = '#2A2530'
  ctx.lineWidth = 1
  for (let i = 0; i <= TICKS; i++) {
    const p = priceMin + (priceMax - priceMin) * (i / TICKS)
    const y = toY(p)
    ctx.beginPath()
    ctx.moveTo(ML, y)
    ctx.lineTo(W - MR, y)
    ctx.stroke()
  }

  // ── paredes do order book (foto atual, agrupada em faixas de preço) ──────────
  // No tick real ($0.01) os níveis ficam colados uns nos outros perto do preço
  // atual — agrupamos em baldes de preço (igual ao Liquidation Heatmap) para
  // as paredes aparecerem como níveis distintos, não uma única linha grossa.
  const BUCKETS = 90
  const bucketBids = new Float64Array(BUCKETS)
  const bucketAsks = new Float64Array(BUCKETS)
  const bucketIdx  = (p: number) =>
    Math.min(BUCKETS - 1, Math.max(0, Math.floor(((p - priceMin) / (priceMax - priceMin)) * BUCKETS)))

  for (const b of bidsRelevant) bucketBids[bucketIdx(b.price)] += b.qty
  for (const a of asksRelevant) bucketAsks[bucketIdx(a.price)] += a.qty

  const maxQty = Math.max(1, ...bucketBids, ...bucketAsks)
  const wallEndX = W - MR

  function drawWalls(c2d: CanvasRenderingContext2D, buckets: Float64Array, color: string) {
    for (let i = 0; i < BUCKETS; i++) {
      const qty = buckets[i]
      if (qty <= 0) continue
      const strength = Math.min(qty / maxQty, 1)
      if (strength < 0.05) continue
      const priceCenter = priceMin + (priceMax - priceMin) * ((i + 0.5) / BUCKETS)
      const y = toY(priceCenter)
      const lineLen = cW * Math.min(0.12 + strength * 0.85, 0.94)
      c2d.save()
      c2d.globalAlpha = 0.35 + strength * 0.55
      c2d.strokeStyle = color
      c2d.lineCap = 'butt'
      c2d.lineWidth = 3 + strength * 2
      c2d.setLineDash([9, 5])
      c2d.beginPath()
      c2d.moveTo(wallEndX - lineLen, y)
      c2d.lineTo(wallEndX, y)
      c2d.stroke()
      c2d.restore()
    }
  }

  // ── candles ───────────────────────────────────────────────────────────────
  const bodyW = Math.max((cW / N) * 0.6, 1)
  for (let i = 0; i < N; i++) {
    const c = candles[i]
    const x = toX(i)
    const up = c.close >= c.open
    const color = up ? '#79EDB0' : '#F6465D'

    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, toY(c.high))
    ctx.lineTo(x, toY(c.low))
    ctx.stroke()

    const yO = toY(c.open), yC = toY(c.close)
    ctx.fillStyle = color
    ctx.fillRect(x - bodyW / 2, Math.min(yO, yC), bodyW, Math.max(Math.abs(yC - yO), 1))
  }

  // paredes desenhadas por cima dos candles — o livro real só existe pertinho
  // do preço atual, então ficam sobre as últimas velas (igual a referência)
  // cores no padrão do exemplo: bids em ciano-esverdeado, asks em laranja
  drawWalls(ctx, bucketBids, '#2DD4BF')
  drawWalls(ctx, bucketAsks, '#FB923C')

  // ── linha + label do preço atual ──────────────────────────────────────────
  const py = toY(lastClose)
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = '#FEF4EB88'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(ML, py)
  ctx.lineTo(W - MR, py)
  ctx.stroke()
  ctx.setLineDash([])

  const label = '$' + lastClose.toLocaleString('en-US', { maximumFractionDigits: 0 })
  ctx.font = '600 11px -apple-system, BlinkMacSystemFont, sans-serif'
  const tw = ctx.measureText(label).width
  const pillW = tw + 14

  ctx.fillStyle = '#FEF4EB'
  ctx.beginPath()
  ctx.roundRect(W - MR + 4, py - 9, pillW, 18, 3)
  ctx.fill()
  ctx.fillStyle = '#141116'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, W - MR + 4 + 7, py)

  // ── labels de preço (eixo Y) ───────────────────────────────────────────────
  ctx.fillStyle = '#9CE8C0'
  ctx.font = '10px -apple-system, sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let i = 0; i <= TICKS; i++) {
    const p = priceMin + (priceMax - priceMin) * (i / TICKS)
    const y = toY(p)
    if (y < MT + 6 || y > H - MB - 6) continue
    const lbl = p >= 1000 ? '$' + (p / 1000).toFixed(1) + 'k' : '$' + p.toFixed(0)
    ctx.fillText(lbl, ML - 5, y)
  }

  // ── labels de data (eixo X) ────────────────────────────────────────────────
  ctx.fillStyle = '#9CE8C0'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const TIME_TICKS = Math.min(6, Math.floor(cW / 110))
  for (let i = 0; i <= TIME_TICKS; i++) {
    const idx = Math.round((i / TIME_TICKS) * (N - 1))
    const x = toX(idx)
    const d = new Date(candles[idx].time)
    ctx.fillText(
      d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
      d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      x,
      H - MB + 4,
    )
  }

  return { currentPrice: lastClose }
}
