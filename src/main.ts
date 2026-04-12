import './style.css'
import { Chart } from 'chart.js'
import type { PythPrice, TickerStats } from './types'
import { streamPyth } from './pyth'
import { connectTickerWS, startMonPolling } from './binance'
import { renderCyclesChart, tickCyclesChart, renderBtcMonChart, tickComparisonChart, resetComparisonZoom } from './charts'
import { createTradingChart, loadTradingChart, tickTradingChart } from './tradingChart'

// ─── HTML ─────────────────────────────────────────────────────────────────────

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <h1>Crypto Dashboard — ao vivo</h1>

  <div class="status-bar">
    <div class="dot" id="dot"></div>
    <span id="status">Conectando...</span>
    <span class="badge pyth">PYTH ORACLE · SSE</span>
    <span class="badge binance">BINANCE WS</span>
  </div>

  <!-- Cards de oráculos: BTC / ETH / SOL -->
  <div class="oracle-grid">

    <div class="oracle-card pyth-card">
      <div class="oracle-header">
        <span class="oracle-coin">₿</span>
        <span class="oracle-name">Bitcoin</span>
        <span class="oracle-tag">BTC/USD</span>
      </div>
      <div class="oracle-price" id="pyth-btc-price">—</div>
      <div class="oracle-meta" id="pyth-btc-conf">aguardando...</div>
      <div class="oracle-meta" id="pyth-btc-age"></div>
    </div>

    <div class="oracle-card eth-card">
      <div class="oracle-header">
        <span class="oracle-coin">Ξ</span>
        <span class="oracle-name">Ethereum</span>
        <span class="oracle-tag">ETH/USD</span>
      </div>
      <div class="oracle-price" id="pyth-eth-price">—</div>
      <div class="oracle-meta" id="pyth-eth-conf">aguardando...</div>
      <div class="oracle-meta" id="pyth-eth-age"></div>
    </div>

    <div class="oracle-card sol-card">
      <div class="oracle-header">
        <span class="oracle-coin">◎</span>
        <span class="oracle-name">Solana</span>
        <span class="oracle-tag">SOL/USD</span>
      </div>
      <div class="oracle-price" id="pyth-sol-price">—</div>
      <div class="oracle-meta" id="pyth-sol-conf">aguardando...</div>
      <div class="oracle-meta" id="pyth-sol-age"></div>
    </div>

    <div class="oracle-card mon-card">
      <div class="oracle-header">
        <span class="oracle-coin">◈</span>
        <span class="oracle-name">Monad</span>
        <span class="oracle-tag">MON/USD</span>
      </div>
      <div class="oracle-price" id="mon-price">—</div>
      <div class="oracle-meta" id="mon-source">buscando exchange...</div>
      <div class="oracle-meta" id="mon-age"></div>
    </div>

  </div>

  <!-- Stats de mercado BTC (Binance WS) -->
  <div class="section-label">Mercado BTC · <span style="color:#f0b90b">Binance WebSocket</span></div>
  <div class="stats">
    <div class="card">
      <div class="label">Variação 24h</div>
      <div class="val" id="s-chg">—</div>
    </div>
    <div class="card">
      <div class="label">Máx 24h</div>
      <div class="val" id="s-high">—</div>
    </div>
    <div class="card">
      <div class="label">Mín 24h</div>
      <div class="val" id="s-low">—</div>
    </div>
    <div class="card">
      <div class="label">Volume 24h (USD)</div>
      <div class="val" id="s-vol">—</div>
      <div class="conf" id="s-vol-btc"></div>
    </div>
  </div>

  <!-- Gráfico de preço BTC -->
  <div class="controls" id="range-controls">
    <button data-days="1">15m · 24h</button>
    <button data-days="7" class="active">1h · 7d</button>
    <button data-days="30">4h · 30d</button>
    <button data-days="90">1d · 90d</button>
    <button data-days="365">1d · 1a</button>
  </div>
  <div class="refresh-header">
    <span class="refresh-label" id="rl-price">próximo reload em —</span>
    <div class="refresh-track"><div class="refresh-fill" id="rf-price"></div></div>
  </div>
  <div class="chart-wrap" id="trading-chart"></div>

  <h2>Ciclos sobrepostos</h2>
  <p class="chart-sub">Comparação alinhada a partir do topo de cada ciclo</p>
  <div class="refresh-header">
    <span class="refresh-label" id="rl-cycles">próximo reload em —</span>
    <div class="refresh-track"><div class="refresh-fill" id="rf-cycles"></div></div>
  </div>
  <div class="chart-wrap" id="wrap-cycles"><canvas id="chart-cycles"></canvas></div>

  <h2>BTC · ETH · SOL · MON (normalizado base 100)</h2>
  <p class="chart-sub">Comparação relativa desde o início da listagem do MON · scroll para zoom · arrastar para pan</p>
  <div class="refresh-header">
    <span class="refresh-label" id="rl-btcmon">atualização ao vivo via Pyth</span>
    <div class="refresh-track"><div class="refresh-fill" id="rf-btcmon"></div></div>
    <button id="btn-reset-zoom" style="padding:3px 10px;font-size:11px;margin-left:8px;">Reset zoom</button>
  </div>
  <div class="chart-wrap" id="wrap-btcmon"><canvas id="chart-btcmon"></canvas></div>

  <h2>Fear &amp; Greed Index</h2>
  <p class="chart-sub">Índice de Medo e Ganância — últimos 30 dias · alternative.me</p>

  <div class="fng-card">
    <div>
      <div class="fng-number" id="fg-num" style="color:#8b949e;">—</div>
      <div class="fng-cls"    id="fg-cls" style="color:#8b949e;">carregando</div>
    </div>
    <div class="fng-bar-wrap">
      <div class="fng-bar">
        <div class="fng-pin" id="fg-pin" style="left:50%;"></div>
      </div>
      <div class="fng-ticks">
        <span>Medo Extremo</span><span>Medo</span><span>Neutro</span><span>Ganância</span><span>Ganância Ext.</span>
      </div>
      <div class="fng-meta" id="fg-meta">aguardando dados...</div>
    </div>
  </div>

  <div class="chart-wrap" id="fg-wrap"><canvas id="fg-canvas"></canvas></div>

  <footer class="footer">
    Created by <a href="https://x.com/shaianeviana" target="_blank" rel="noopener">shaianeviana</a>
  </footer>
`

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const $ = (id: string) => document.getElementById(id)!

const dot      = $('dot')
const statusEl = $('status')

// Binance stats
const chgEl    = $('s-chg')
const highEl   = $('s-high')
const lowEl    = $('s-low')
const volEl    = $('s-vol')
const volBtcEl = $('s-vol-btc')

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 2): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

// ─── Pyth multi-feed: BTC + ETH + SOL ────────────────────────────────────────

// guarda último preço de cada ativo para o flash
const prevPrice: Record<string, number | null> = { btc: null, eth: null, sol: null }

function updateOracleCard(
  sym: string,
  { price, conf, age }: PythPrice,
  decimals: number,
) {
  const priceEl = $(`pyth-${sym}-price`)
  const confEl  = $(`pyth-${sym}-conf`)
  const ageEl   = $(`pyth-${sym}-age`)
  const prev    = prevPrice[sym]

  // flash
  priceEl.classList.remove('flash-up', 'flash-down')
  void priceEl.offsetWidth
  if (prev !== null) priceEl.classList.add(price >= prev ? 'flash-up' : 'flash-down')

  prevPrice[sym] = price
  priceEl.textContent = fmt(price, decimals)
  confEl.textContent  = `±$${conf.toFixed(decimals)} confiança`
  ageEl.textContent   = `publicado há ${age}s`
}

streamPyth(
  { BTC: true, ETH: true, SOL: true },
  (prices) => {
    if (prices.BTC) updateOracleCard('btc', prices.BTC, 2)
    if (prices.ETH) updateOracleCard('eth', prices.ETH, 2)
    if (prices.SOL) updateOracleCard('sol', prices.SOL, 3)

    // ── tick ao vivo nos 3 gráficos ──
    if (prices.BTC) {
      tickTradingChart(prices.BTC.price)
      tickCyclesChart(prices.BTC.price)
    }
    tickComparisonChart({
      BTC: prices.BTC?.price,
      ETH: prices.ETH?.price,
      SOL: prices.SOL?.price,
    })
    pulseBtcmonBar()

    if (prices.BTC || prices.ETH || prices.SOL)
      statusEl.textContent = 'Ao vivo · Pyth ' + new Date().toLocaleTimeString('pt-BR')
  },
  e => console.warn('Pyth SSE:', e.message),
)

// ─── MON polling (multi-exchange) ────────────────────────────────────────────

const monPriceEl  = $('mon-price')
const monSourceEl = $('mon-source')
const monAgeEl    = $('mon-age')
let prevMonPrice: number | null = null
let monLastTs = 0

startMonPolling(
  (price) => {
    monPriceEl.classList.remove('flash-up', 'flash-down')
    void monPriceEl.offsetWidth
    if (prevMonPrice !== null)
      monPriceEl.classList.add(price >= prevMonPrice ? 'flash-up' : 'flash-down')
    prevMonPrice = price
    monLastTs = Date.now()
    monPriceEl.textContent  = '$' + price.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
    monSourceEl.textContent = 'exchange spot'
    monAgeEl.textContent    = 'atualizado agora'
  },
  (e) => {
    monSourceEl.textContent = e.message
  },
)

// atualiza o "atualizado há Xs" do MON a cada segundo
setInterval(() => {
  if (monLastTs) {
    const ago = Math.round((Date.now() - monLastTs) / 1000)
    monAgeEl.textContent = `atualizado há ${ago}s`
  }
}, 1000)

// ─── Binance WebSocket ticker (BTC market stats) ──────────────────────────────

function onTick({ change24h, high24h, low24h, volumeUSD, volumeBTC }: TickerStats) {
  const sign = change24h >= 0 ? '+' : ''
  chgEl.className   = 'val ' + (change24h >= 0 ? 'up' : 'down')
  chgEl.textContent = sign + change24h.toFixed(2) + '%'
  highEl.textContent = '$' + high24h.toLocaleString('en-US', { maximumFractionDigits: 0 })
  lowEl.textContent  = '$' + low24h.toLocaleString('en-US',  { maximumFractionDigits: 0 })
  volEl.textContent  = '$' + (volumeUSD / 1e9).toFixed(2) + 'B'
  volBtcEl.textContent = volumeBTC.toFixed(0) + ' BTC'
}

function onWsStatus(connected: boolean) {
  dot.classList.toggle('err', !connected)
  if (!connected) statusEl.textContent = 'WebSocket Binance reconectando...'
}

connectTickerWS('BTCUSDT', onTick, onWsStatus)

// ─── Range buttons ────────────────────────────────────────────────────────────

let currentDays = 7

$('range-controls').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button')
  if (!btn) return
  currentDays = parseInt(btn.dataset.days ?? '7', 10)
  document.querySelectorAll('#range-controls button').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  loadTradingChart(currentDays).then(() => barPrice.reset()).catch(console.error)
})

document.getElementById('btn-reset-zoom')!.addEventListener('click', resetComparisonZoom)

function chartError(wrapId: string, msg: string) {
  $(wrapId).innerHTML = `<div class="chart-err">${msg}</div>`
}

// ─── Barra de progresso de refresh ───────────────────────────────────────────

class RefreshBar {
  private fillEl: HTMLElement
  private labelEl: HTMLElement
  private intervalMs: number
  private startTime = Date.now()
  private fmtRemaining: (ms: number) => string

  constructor(fillId: string, labelId: string, intervalMs: number, fmtFn?: (ms: number) => string) {
    this.fillEl    = $(fillId)
    this.labelEl   = $(labelId)
    this.intervalMs = intervalMs
    this.fmtRemaining = fmtFn ?? ((ms) => `próximo reload em ${Math.ceil(ms / 1000)}s`)
    this.tick()
  }

  reset() { this.startTime = Date.now() }

  private tick = () => {
    const elapsed   = Date.now() - this.startTime
    const remaining = Math.max(this.intervalMs - elapsed, 0)
    const pct       = Math.min((elapsed / this.intervalMs) * 100, 100)
    this.fillEl.style.width   = pct + '%'
    this.labelEl.textContent  = this.fmtRemaining(remaining)
    requestAnimationFrame(this.tick)
  }
}

const fmtHMS = (ms: number) => {
  const total = Math.ceil(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0
    ? `próximo reload em ${h}h ${m}m`
    : m > 0
      ? `próximo reload em ${m}m ${s}s`
      : `próximo reload em ${s}s`
}

const barPrice  = new RefreshBar('rf-price',  'rl-price',  60_000)
const barCycles = new RefreshBar('rf-cycles', 'rl-cycles', 6 * 60 * 60 * 1000, fmtHMS)

// barra do gráfico de comparação: pulsa a cada tick Pyth (~400ms)
const rfBtcmon = $('rf-btcmon') as HTMLElement
let btcmonPulse = 0
function pulseBtcmonBar() {
  clearTimeout(btcmonPulse)
  rfBtcmon.style.width = '100%'
  btcmonPulse = setTimeout(() => { rfBtcmon.style.width = '0%' }, 300) as unknown as number
}

// ─── Init ─────────────────────────────────────────────────────────────────────

const tradingContainer = $('trading-chart') as HTMLElement
createTradingChart(tradingContainer)
loadTradingChart(currentDays).then(() => barPrice.reset()).catch(console.error)
setInterval(() => {
  loadTradingChart(currentDays).then(() => barPrice.reset()).catch(console.error)
}, 60_000)

const cyclesCanvas = $('chart-cycles') as HTMLCanvasElement

const refreshCycles = () =>
  renderCyclesChart(cyclesCanvas)
    .then(() => barCycles.reset())
    .catch(e => chartError('wrap-cycles', 'Erro ciclos: ' + (e as Error).message))

setTimeout(refreshCycles, 1500)
setInterval(refreshCycles, 6 * 60 * 60 * 1000)

setTimeout(() => {
  renderBtcMonChart($('chart-btcmon') as HTMLCanvasElement)
    .catch(e => chartError('wrap-btcmon', 'Erro: ' + (e as Error).message))
}, 3000)

// ─── Fear & Greed Index ───────────────────────────────────────────────────────

const FG_CLASSES: Record<string, string> = {
  'Extreme Fear': 'Medo Extremo',
  'Fear': 'Medo',
  'Neutral': 'Neutro',
  'Greed': 'Ganância',
  'Extreme Greed': 'Ganância Extrema',
}

function fgColor(v: number): string {
  if (v <= 24) return '#f85149'
  if (v <= 44) return '#e6855a'
  if (v <= 54) return '#e6b450'
  if (v <= 74) return '#7fb950'
  return '#3fb950'
}

interface FngEntry { value: string; value_classification: string; timestamp: string; time_until_update?: string }

async function fgTry(url: string, ms: number): Promise<FngEntry[]> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    fetch(url)
      .then(r => { clearTimeout(t); return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)) })
      .then((j: { data?: FngEntry[] }) => (j?.data?.length) ? resolve(j.data) : reject(new Error('vazio')))
      .catch(e => { clearTimeout(t); reject(e) })
  })
}

let fgChartInstance: Chart | null = null

async function loadFearGreed() {
  const wrap   = $('fg-wrap') as HTMLElement
  const meta   = $('fg-meta') as HTMLElement
  meta.textContent = 'Buscando dados...'
  wrap.innerHTML   = '<div style="color:#8b949e;padding:60px;text-align:center;font-size:13px;">Carregando Fear &amp; Greed Index...</div>'

  const BASE = encodeURIComponent('https://api.alternative.me/fng/?limit=30')
  const SRCS = [
    'https://api.alternative.me/fng/?limit=30',
    'https://api.allorigins.win/raw?url=' + BASE,
    'https://corsproxy.io/?' + BASE,
    'https://api.codetabs.com/v1/proxy?quest=' + BASE,
  ]

  let raw: FngEntry[]
  try {
    raw = await Promise.any(SRCS.map((url, i) => fgTry(url, 5000 + i * 2000)))
  } catch {
    meta.textContent = 'Falha em todas as fontes'
    wrap.innerHTML = `<div style="color:#f85149;padding:40px;text-align:center;font-size:13px;">
      Fear &amp; Greed Index indisponível<br>
      <button onclick="loadFearGreed()" style="margin-top:14px;">Tentar novamente</button>
    </div>`
    return
  }

  wrap.innerHTML = '<canvas id="fg-canvas"></canvas>'

  const today = raw[0]
  const val   = parseInt(today.value)
  const col   = fgColor(val)

  ;($('fg-num') as HTMLElement).textContent = String(val);
  ($('fg-num') as HTMLElement).style.color  = col;
  ($('fg-cls') as HTMLElement).textContent  = FG_CLASSES[today.value_classification] ?? today.value_classification;
  ($('fg-cls') as HTMLElement).style.color  = col;
  ($('fg-pin') as HTMLElement).style.left   = val + '%'

  const next = parseInt(today.time_until_update ?? '')
  meta.textContent = isNaN(next)
    ? 'fonte: alternative.me'
    : `Atualiza em ${Math.floor(next / 3600)}h ${Math.floor((next % 3600) / 60)}m · fonte: alternative.me`

  const pts    = [...raw].reverse()
  const labels = pts.map(d => new Date(+d.timestamp * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }))
  const vals   = pts.map(d => parseInt(d.value))
  const colors = vals.map(fgColor)

  if (fgChartInstance) { fgChartInstance.destroy(); fgChartInstance = null }
  fgChartInstance = new Chart($('fg-canvas') as HTMLCanvasElement, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Fear & Greed',
        data: vals,
        borderColor: col,
        backgroundColor: col + '22',
        fill: true,
        tension: .35,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: colors,
        pointBorderColor: '#0d1117',
        pointBorderWidth: 2,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const v = ctx.parsed.y
              const entry = pts[ctx.dataIndex]
              return `${v} — ${FG_CLASSES[entry.value_classification] ?? entry.value_classification}`
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: '#8b949e', maxTicksLimit: 10 }, grid: { color: '#21262d' } },
        y: { min: 0, max: 100, ticks: { color: '#8b949e', stepSize: 25 }, grid: { color: '#21262d' } },
      },
    },
  })
}

setTimeout(loadFearGreed, 4500)
setInterval(loadFearGreed, 5 * 60 * 1000)
