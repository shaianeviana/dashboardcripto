// Gera public/daily-summary.json: um resumo diário do mercado cripto escrito
// por IA, a partir de dados de mercado + manchetes de notícias. Pensado para
// rodar 1x/dia via GitHub Actions (.github/workflows/daily-summary.yml).
//
// Uso local: ANTHROPIC_API_KEY=sk-... node scripts/generate-summary.mjs

import { writeFile } from 'node:fs/promises'

// chaves de API nunca contêm espaços/quebras de linha; remover tudo isso
// protege contra secrets colados com quebra de linha embutida (ex: copiado
// de uma fonte com word-wrap, como um PDF ou página web)
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY?.replace(/\s+/g, '')
if (!ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY não definida — abortando.')
  process.exit(1)
}

const OUT_PATH = new URL('../public/daily-summary.json', import.meta.url)

// ─── Coleta de dados de mercado ─────────────────────────────────────────────

async function fetchJson(url, opts) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000), ...opts })
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`)
  return r.json()
}

async function getMarketSnapshot() {
  const snapshot = {}

  try {
    const price = await fetchJson(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true'
    )
    snapshot.prices = price
  } catch (e) {
    console.error('Falha ao buscar preços CoinGecko:', e.message)
  }

  try {
    const fng = await fetchJson('https://api.alternative.me/fng/?limit=2')
    snapshot.fearGreed = fng.data?.map(d => ({ value: d.value, label: d.value_classification }))
  } catch (e) {
    console.error('Falha ao buscar Fear & Greed:', e.message)
  }

  try {
    const cm = await fetchJson(
      'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics' +
      '?assets=btc&metrics=CapMrktCurUSD,CapRealUSD&frequency=1d&page_size=2'
    )
    const rows = cm.data ?? []
    const last = rows[rows.length - 1]
    if (last?.CapMrktCurUSD && last?.CapRealUSD) {
      const mkt = parseFloat(last.CapMrktCurUSD)
      const real = parseFloat(last.CapRealUSD)
      snapshot.mvrv = +(mkt / real).toFixed(3)
      snapshot.nupl = +((mkt - real) / mkt).toFixed(3)
    }
  } catch (e) {
    console.error('Falha ao buscar MVRV/NUPL (CoinMetrics):', e.message)
  }

  return snapshot
}

// ─── Notícias via RSS (sem chave de API) ────────────────────────────────────

const RSS_FEEDS = [
  { name: 'CoinDesk',      url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'CoinTelegraph', url: 'https://cointelegraph.com/rss' },
  { name: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml' },
]

function extractTitles(xml, limit) {
  const titles = []
  const itemRe = /<item[\s\S]*?<\/item>/g
  const titleRe = /<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/
  for (const block of xml.match(itemRe) ?? []) {
    const m = block.match(titleRe)
    if (m?.[1]) titles.push(m[1].trim())
    if (titles.length >= limit) break
  }
  return titles
}

async function getHeadlines() {
  const headlines = []
  for (const feed of RSS_FEEDS) {
    try {
      const r = await fetch(feed.url, { signal: AbortSignal.timeout(12_000) })
      if (!r.ok) continue
      const xml = await r.text()
      const titles = extractTitles(xml, feed.name === 'Federal Reserve' ? 3 : 5)
      headlines.push({ source: feed.name, titles })
    } catch (e) {
      console.error(`Falha ao buscar RSS ${feed.name}:`, e.message)
    }
  }
  return headlines
}

// ─── Geração via Claude ──────────────────────────────────────────────────────

async function generateSummary(snapshot, headlines) {
  const dataBlock = JSON.stringify(snapshot, null, 2)
  const newsBlock = headlines
    .map(h => `${h.source}:\n${h.titles.map(t => `- ${t}`).join('\n')}`)
    .join('\n\n')

  const prompt = `Você escreve um resumo diário curto (para um dashboard de cripto) explicando o que está acontecendo no mercado hoje e POR QUÊ, cruzando os dados de mercado com as manchetes de notícia relevantes (Fed, macro, cripto).

DADOS DE MERCADO (JSON):
${dataBlock}

MANCHETES RECENTES:
${newsBlock}

Responda em português do Brasil, tom direto e informativo (não robótico), 2 a 4 frases, sem markdown. Explique a causa provável do movimento (ex: decisão do Fed, dado de inflação, fluxo de ETF, evento on-chain), não apenas descreva os números. Depois responda em uma linha separada apenas com a palavra "positivo", "negativo" ou "neutro" representando o sentimento geral do dia.

Formato da resposta (texto puro, sem markdown, sem JSON):
<resumo de 2-4 frases>
SENTIMENT: <positivo|negativo|neutro>`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    throw new Error(`Anthropic API → HTTP ${res.status}: ${await res.text()}`)
  }

  const body = await res.json()
  const text = body.content?.[0]?.text?.trim() ?? ''

  const match = text.match(/SENTIMENT:\s*(positivo|negativo|neutro)/i)
  const sentiment = match ? match[1].toLowerCase() : 'neutro'
  const summary = text.replace(/SENTIMENT:\s*(positivo|negativo|neutro)/i, '').trim()

  return { summary, sentiment }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const [snapshot, headlines] = await Promise.all([getMarketSnapshot(), getHeadlines()])
  const { summary, sentiment } = await generateSummary(snapshot, headlines)

  const output = {
    generatedAt: new Date().toISOString(),
    sentiment,
    summary,
  }

  await writeFile(OUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf-8')
  console.log('daily-summary.json gerado:', output)
}

main().catch(e => {
  console.error('Falha ao gerar resumo diário:', e)
  process.exit(1)
})
