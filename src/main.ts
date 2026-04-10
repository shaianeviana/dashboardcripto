import './style.css'
import type { PythPrice, TickerStats } from './types'
import { streamPyth } from './pyth'
import { connectTickerWS, startMonPolling } from './binance'
import { renderPriceChart, tickPriceChart, renderCyclesChart, tickCyclesChart, renderBtcMonChart, tickComparisonChart } from './charts'

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
    <button data-days="1">24h</button>
    <button data-days="7" class="active">7d</button>
    <button data-days="30">30d</button>
    <button data-days="90">90d</button>
    <button data-days="365">1a</button>
  </div>
  <div class="chart-wrap"><canvas id="chart-price"></canvas></div>

  <h2>Ciclos sobrepostos</h2>
  <p class="chart-sub">Comparação alinhada a partir do topo de cada ciclo</p>
  <div class="chart-wrap" id="wrap-cycles"><canvas id="chart-cycles"></canvas></div>

  <h2>BTC · ETH · SOL · MON (normalizado base 100)</h2>
  <p class="chart-sub">Comparação relativa desde o início da listagem do MON</p>
  <div class="chart-wrap" id="wrap-btcmon"><canvas id="chart-btcmon"></canvas></div>

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
      tickPriceChart(prices.BTC.price)
      tickCyclesChart(prices.BTC.price)
    }
    tickComparisonChart({
      BTC: prices.BTC?.price,
      ETH: prices.ETH?.price,
      SOL: prices.SOL?.price,
    })

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
const priceCanvas = $('chart-price') as HTMLCanvasElement

$('range-controls').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button')
  if (!btn) return
  currentDays = parseInt(btn.dataset.days ?? '7', 10)
  document.querySelectorAll('#range-controls button').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  renderPriceChart(priceCanvas, currentDays).catch(console.error)
})

function chartError(wrapId: string, msg: string) {
  $(wrapId).innerHTML = `<div class="chart-err">${msg}</div>`
}

// ─── Init ─────────────────────────────────────────────────────────────────────

renderPriceChart(priceCanvas, currentDays).catch(console.error)
setInterval(() => renderPriceChart(priceCanvas, currentDays).catch(console.error), 60_000)

const cyclesCanvas = $('chart-cycles') as HTMLCanvasElement

const refreshCycles = () =>
  renderCyclesChart(cyclesCanvas).catch(e => chartError('wrap-cycles', 'Erro ciclos: ' + (e as Error).message))

setTimeout(refreshCycles, 1500)
// atualiza a cada 6h — candles diários mudam 1x por dia, mas o ciclo atual avança
setInterval(refreshCycles, 6 * 60 * 60 * 1000)

setTimeout(() => {
  renderBtcMonChart($('chart-btcmon') as HTMLCanvasElement)
    .catch(e => chartError('wrap-btcmon', 'Erro: ' + (e as Error).message))
}, 3000)
