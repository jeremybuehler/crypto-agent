export function computeFeatures(candles, market) {
    if (candles.length < 5) {
        throw new Error("At least 5 candles are required to compute initial features.");
    }
    const closes = candles.map((candle) => candle.close);
    const smaFast = average(closes.slice(-3));
    const smaSlow = average(closes.slice(-5));
    const first = closes.at(-5);
    const last = closes.at(-1);
    if (first === undefined || last === undefined) {
        throw new Error("Unable to compute momentum from empty candles.");
    }
    const returns = closes.slice(1).map((close, index) => Math.abs((close - closes[index]) / closes[index]));
    const realizedVol = average(returns) * 100;
    return {
        productId: market.productId,
        generatedAt: new Date(),
        close: last,
        smaFast,
        smaSlow,
        momentumPct: ((last - first) / first) * 100,
        volatilityPercentile: Math.min(100, Math.round(realizedVol * 25)),
        spreadBps: market.spreadBps
    };
}
function average(values) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
