const baseUrl = process.env.BARLAS_LOAD_URL;
if (!baseUrl) throw new Error("Set BARLAS_LOAD_URL to an isolated Barlas AI Agent deployment");
const requests = boundedInteger(process.env.BARLAS_LOAD_REQUESTS, 200, 1, 10_000);
const concurrency = boundedInteger(process.env.BARLAS_LOAD_CONCURRENCY, 20, 1, 200);
const latencies = [];
let failures = 0;
let cursor = 0;

await Promise.all(Array.from({ length: concurrency }, async () => {
  while (cursor < requests) {
    const index = cursor;
    cursor += 1;
    const started = performance.now();
    try {
      const response = await fetch(new URL(index % 2 === 0 ? "/health" : "/ready", baseUrl), {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) failures += 1;
      await response.arrayBuffer();
    } catch {
      failures += 1;
    }
    latencies.push(performance.now() - started);
  }
}));

latencies.sort((left, right) => left - right);
const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] ?? 0;
const summary = { requests, concurrency, failures, p95Ms: Number(p95.toFixed(1)) };
console.log(JSON.stringify(summary));
if (failures > 0) throw new Error(`Load smoke test recorded ${failures} failures`);

function boundedInteger(raw, fallback, minimum, maximum) {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error("Invalid load-test setting");
  return value;
}
