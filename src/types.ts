export interface PythPrice {
  price: number;   // USD
  conf: number;    // confidence interval ±
  age: number;     // seconds since publish
}

export interface ChainlinkPrice {
  price: number;       // USD (8 decimals on-chain)
  updatedAt: number;   // unix timestamp
  roundId: bigint;
}

export interface TickerStats {
  price: number;
  change24h: number;  // percent
  high24h: number;
  low24h: number;
  volumeUSD: number;
  volumeBTC: number;
}

export interface Kline {
  time: number;
  close: number;
}

export interface Candle {
  time: number;    // ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
