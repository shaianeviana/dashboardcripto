/**
 * Gráfico de trade estilo TradingView usando Lightweight Charts v5
 * Candlestick + Volume + zoom/pan nativo
 */

import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickSeriesOptions,
  type HistogramSeriesOptions,
  type UTCTimestamp,
} from 'lightweight-charts'
import { fetchCandles } from './binance'
import type { Candle } from './types'

// ─── estado ───────────────────────────────────────────────────────────────────

let chart:       IChartApi | null = null
let candleSeries: ISeriesApi<'Candlestick'> | null = null
let volSeries:    ISeriesApi<'Histogram'>   | null = null
let lastCandle:   Candle | null = null
let currentDays = 7

// ─── helpers ──────────────────────────────────────────────────────────────────

function intervalFor(days: number) {
  if (days <= 1)   return { interval: '15m', limit: 96  }
  if (days <= 7)   return { interval: '1h',  limit: 168 }
  if (days <= 30)  return { interval: '4h',  limit: 180 }
  if (days <= 90)  return { interval: '1d',  limit: 90  }
  return               { interval: '1d',  limit: 365 }
}

const toSec = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp

const upColor   = '#79EDB0'
const downColor = '#FE6AA4'
const wickUp    = '#79EDB0'
const wickDown  = '#FE6AA4'

// ─── criação do chart ─────────────────────────────────────────────────────────

export function createTradingChart(container: HTMLElement): void {
  chart?.remove()

  chart = createChart(container, {
    layout: {
      background: { color: '#1D1922' },
      textColor:  '#9CE8C0',
    },
    grid: {
      vertLines: { color: '#2A2530' },
      horzLines: { color: '#2A2530' },
    },
    crosshair: {
      vertLine: { color: '#79EDB060', width: 1, style: 2 },
      horzLine: { color: '#79EDB060', width: 1, style: 2 },
    },
    rightPriceScale: {
      borderColor: '#000000',
      scaleMargins: { top: 0.1, bottom: 0.25 },
    },
    timeScale: {
      borderColor:       '#000000',
      timeVisible:       true,
      secondsVisible:    false,
      fixLeftEdge:       false,
      fixRightEdge:      false,
      rightOffset:       5,
    },
    handleScroll:  true,
    handleScale:   true,
    width:  container.clientWidth,
    height: container.clientHeight,
  })

  // Candlestick
  candleSeries = chart.addSeries(CandlestickSeries, {
    upColor,
    downColor,
    borderUpColor:   upColor,
    borderDownColor: downColor,
    wickUpColor:     wickUp,
    wickDownColor:   wickDown,
  } as Partial<CandlestickSeriesOptions>)

  // Volume (histograma no fundo, 20% da altura)
  volSeries = chart.addSeries(HistogramSeries, {
    color:          '#9CE8C040',
    priceFormat:    { type: 'volume' },
    priceScaleId:   'vol',
  } as Partial<HistogramSeriesOptions>)

  chart.priceScale('vol').applyOptions({
    scaleMargins: { top: 0.85, bottom: 0 },
  })

  // resize responsivo
  const ro = new ResizeObserver(() => {
    chart?.applyOptions({
      width:  container.clientWidth,
      height: container.clientHeight,
    })
  })
  ro.observe(container)
}

// ─── carrega dados ────────────────────────────────────────────────────────────

export async function loadTradingChart(days: number): Promise<void> {
  if (!chart || !candleSeries || !volSeries) return
  currentDays = days

  const { interval, limit } = intervalFor(days)
  const candles = await fetchCandles('BTCUSDT', interval, limit)
  if (!candles.length) return

  lastCandle = candles[candles.length - 1]

  candleSeries.setData(candles.map(c => ({
    time:  toSec(c.time),
    open:  c.open,
    high:  c.high,
    low:   c.low,
    close: c.close,
  })))

  volSeries.setData(candles.map(c => ({
    time:  toSec(c.time),
    value: c.volume,
    color: c.close >= c.open ? upColor + '80' : downColor + '80',
  })))

  chart.timeScale().fitContent()
}

// ─── tick ao vivo ─────────────────────────────────────────────────────────────

export function tickTradingChart(price: number): void {
  if (!candleSeries || !lastCandle) return

  // atualiza o último candle em memória
  lastCandle.close = price
  if (price > lastCandle.high) lastCandle.high = price
  if (price < lastCandle.low)  lastCandle.low  = price

  candleSeries.update({
    time:  toSec(lastCandle.time),
    open:  lastCandle.open,
    high:  lastCandle.high,
    low:   lastCandle.low,
    close: lastCandle.close,
  })
}

export { currentDays }
