/**
 * Chainlink Data Feeds — leitura on-chain via JSON-RPC público (sem biblioteca)
 *
 * Contrato: AggregatorV3Interface
 * Feed BTC/USD Ethereum Mainnet: 0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88b
 * Decimais: 8
 *
 * Docs: https://docs.chain.link/data-feeds/price-feeds/addresses
 */

import type { ChainlinkPrice } from './types'

// Feed BTC/USD na Ethereum Mainnet
export const CHAINLINK_BTC_USD = '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88b'

// RPCs públicos Ethereum (tentativa em ordem)
const ETH_RPCS = [
  'https://eth.llamarpc.com',
  'https://cloudflare-eth.com',
  'https://rpc.ankr.com/eth',
]

// Selector de latestRoundData() — keccak256('latestRoundData()')[:4]
const LATEST_ROUND_DATA = '0xfeaf968c'

/**
 * Decodifica o retorno ABI de latestRoundData():
 *   (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
 * Cada slot = 32 bytes = 64 hex chars.
 */
function decode(hex: string): ChainlinkPrice {
  // remove '0x', divide em slots de 64 chars
  const raw = hex.startsWith('0x') ? hex.slice(2) : hex
  const slot = (i: number) => raw.slice(i * 64, (i + 1) * 64)

  const roundId   = BigInt('0x' + slot(0))
  const answer    = BigInt('0x' + slot(1))   // int256, sempre positivo para BTC
  const updatedAt = Number(BigInt('0x' + slot(3)))

  return {
    price:     Number(answer) / 1e8,  // 8 decimais
    updatedAt,
    roundId,
  }
}

async function callRPC(rpc: string, to: string, data: string): Promise<string> {
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to, data }, 'latest'],
      id: 1,
    }),
  })
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`)
  const json: { result?: string; error?: { message: string } } = await res.json()
  if (json.error) throw new Error(json.error.message)
  if (!json.result) throw new Error('RPC sem resultado')
  return json.result
}

/** Lê o preço atual do feed Chainlink com fallback entre RPCs públicos */
export async function fetchChainlinkBTC(feed = CHAINLINK_BTC_USD): Promise<ChainlinkPrice> {
  let lastErr: Error = new Error('Nenhum RPC disponível')

  for (const rpc of ETH_RPCS) {
    try {
      const result = await callRPC(rpc, feed, LATEST_ROUND_DATA)
      return decode(result)
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e))
    }
  }

  throw lastErr
}

/** Polling contínuo do Chainlink */
export function startChainlinkPolling(
  onUpdate: (p: ChainlinkPrice) => void,
  onError: (e: Error) => void,
  feed = CHAINLINK_BTC_USD,
  intervalMs = 15_000   // Chainlink BTC/USD atualiza a cada ~15-60s on-chain
): () => void {
  let timer: ReturnType<typeof setTimeout>

  const poll = async () => {
    try {
      onUpdate(await fetchChainlinkBTC(feed))
    } catch (e) {
      onError(e instanceof Error ? e : new Error(String(e)))
    }
    timer = setTimeout(poll, intervalMs)
  }

  poll()
  return () => clearTimeout(timer)
}
