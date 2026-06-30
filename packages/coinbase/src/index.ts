import type { AgentConfig } from "@agent/core";
import type { Candle } from "@agent/market-data";
import { SignJWT, importPKCS8 } from "jose";

export * from "./schemas.js";
export * from "./order-client.js";

export interface CoinbaseRequestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: `/${string}`;
  body?: unknown;
}

export class CoinbaseAuth {
  constructor(private readonly config: AgentConfig["coinbase"]) {}

  async generateJwt(options: Pick<CoinbaseRequestOptions, "method" | "path">): Promise<string> {
    if (!this.config.apiKeyName || !this.config.apiPrivateKey) {
      throw new Error("Coinbase credentials are not configured.");
    }

    const privateKey = await importPKCS8(this.config.apiPrivateKey.replace(/\\n/g, "\n"), "ES256");
    const now = Math.floor(Date.now() / 1000);
    const url = new URL(this.config.restBaseUrl);
    const fullPath = `${url.pathname}${options.path}`;

    return new SignJWT({
      sub: this.config.apiKeyName,
      iss: "cdp",
      nbf: now,
      exp: now + 120,
      uris: [`${options.method} ${url.host}${fullPath}`]
    })
      .setProtectedHeader({
        alg: "ES256",
        kid: this.config.apiKeyName,
        nonce: crypto.randomUUID()
      })
      .sign(privateKey);
  }
}

export class CoinbaseRestClient {
  private readonly auth: CoinbaseAuth;

  constructor(private readonly config: AgentConfig["coinbase"]) {
    this.auth = new CoinbaseAuth(config);
  }

  async request<T>(options: CoinbaseRequestOptions): Promise<T> {
    const token = await this.auth.generateJwt(options);
    const requestInit: RequestInit = {
      method: options.method,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      }
    };

    if (options.body !== undefined) {
      requestInit.body = JSON.stringify(options.body);
    }

    const response = await fetch(`${this.config.restBaseUrl}${options.path}`, requestInit);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Coinbase request failed ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  async publicRequest<T>(path: `/${string}`): Promise<T> {
    const response = await fetch(`${this.config.restBaseUrl}${path}`, {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Coinbase public request failed ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }
}

export type CoinbaseGranularity =
  | "ONE_MINUTE"
  | "FIVE_MINUTE"
  | "FIFTEEN_MINUTE"
  | "THIRTY_MINUTE"
  | "ONE_HOUR"
  | "TWO_HOUR"
  | "FOUR_HOUR"
  | "SIX_HOUR"
  | "ONE_DAY";

interface CoinbasePublicCandle {
  start: string;
  low: string;
  high: string;
  open: string;
  close: string;
  volume: string;
}

interface CoinbasePublicCandlesResponse {
  candles: CoinbasePublicCandle[];
}

interface CoinbasePriceBookResponse {
  pricebook?: {
    product_id: string;
    bids: Array<{ price: string; size: string }>;
    asks: Array<{ price: string; size: string }>;
    time: string;
  };
  pricebooks?: Array<{
    product_id: string;
    bids: Array<{ price: string; size: string }>;
    asks: Array<{ price: string; size: string }>;
    time: string;
  }>;
}

export class CoinbasePublicMarketData {
  private readonly client: CoinbaseRestClient;

  constructor(private readonly config: AgentConfig["coinbase"]) {
    this.client = new CoinbaseRestClient(config);
  }

  async getCandles(options: {
    productId: `${string}-${string}`;
    granularity: CoinbaseGranularity;
    limit: number;
    end?: Date;
  }): Promise<Candle[]> {
    const end = Math.floor((options.end?.getTime() ?? Date.now()) / 1000);
    const seconds = granularitySeconds(options.granularity);
    const start = end - options.limit * seconds;
    const path = `/market/products/${encodeURIComponent(options.productId)}/candles?start=${start}&end=${end}&granularity=${options.granularity}&limit=${options.limit}` as const;
    const response = await this.client.publicRequest<CoinbasePublicCandlesResponse>(path);

    return response.candles
      .map((candle) => ({
        productId: options.productId,
        start: new Date(Number(candle.start) * 1000),
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
        volume: Number(candle.volume)
      }))
      .filter((candle) =>
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close) &&
        Number.isFinite(candle.volume)
      )
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  async getBestBidAsk(productId: `${string}-${string}`) {
    const path = `/market/product_book?product_id=${encodeURIComponent(productId)}&limit=1` as const;
    const response = await this.client.publicRequest<CoinbasePriceBookResponse>(path);
    const pricebook = response.pricebook ?? response.pricebooks?.[0];
    const bid = Number(pricebook?.bids?.[0]?.price);
    const ask = Number(pricebook?.asks?.[0]?.price);

    if (!pricebook || !Number.isFinite(bid) || !Number.isFinite(ask)) {
      throw new Error(`Coinbase product book did not include a usable bid/ask for ${productId}.`);
    }

    const mid = (bid + ask) / 2;
    return {
      productId,
      price: mid,
      bid,
      ask,
      spreadBps: ((ask - bid) / mid) * 10_000,
      timestamp: pricebook.time ? new Date(pricebook.time) : new Date()
    };
  }
}

function granularitySeconds(granularity: CoinbaseGranularity): number {
  switch (granularity) {
    case "ONE_MINUTE":
      return 60;
    case "FIVE_MINUTE":
      return 300;
    case "FIFTEEN_MINUTE":
      return 900;
    case "THIRTY_MINUTE":
      return 1800;
    case "ONE_HOUR":
      return 3600;
    case "TWO_HOUR":
      return 7200;
    case "FOUR_HOUR":
      return 14400;
    case "SIX_HOUR":
      return 21600;
    case "ONE_DAY":
      return 86400;
  }
}
