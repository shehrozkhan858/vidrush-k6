#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { accumulateError, renderErrorSection, escapeHtml } = require('./lib/errorSection');

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[Math.max(0, index)];
}

function formatMs(value) {
  return `${value.toFixed(1)} ms`;
}

function formatKB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function getDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function nextSequentialPath(outDir, label, dateStamp) {
  fs.mkdirSync(outDir, { recursive: true });
  let n = 1;
  let candidate;
  do {
    candidate = path.join(outDir, `${label}-${dateStamp}-${n}.html`);
    n += 1;
  } while (fs.existsSync(candidate));
  return candidate;
}

function newEndpointEntry() {
  return { samples: 0, fails: 0, durations: [] };
}

// Parses NDJSON produced by `k6 run --out json=<file>` (one JSON object per
// line: { type: 'Point', metric: '<name>', data: { time, value, tags } }).
// Streams line-by-line so large/long-running test output doesn't need to be
// loaded into memory all at once.
//
// Note: data_sent/data_received are connection-level metrics k6 does not tag
// with the request's `name`/`url` — they can only be totalled for the whole
// run, not attributed to a specific endpoint.
async function parseNdjson(inputFile) {
  const endpoints = new Map();
  const errorBuckets = new Map();
  const vuPoints = [];
  const durationPoints = [];
  let checksPass = 0;
  let checksFail = 0;
  let firstTime = null;
  let lastTime = null;
  let vusMax = 0;
  let totalSentBytes = 0;
  let totalReceivedBytes = 0;

  const endpointFor = (tags) => tags.name || tags.url || 'unknown';
  const getOrCreate = (name) => {
    const existing = endpoints.get(name);
    if (existing) return existing;
    const created = newEndpointEntry();
    endpoints.set(name, created);
    return created;
  };

  const rl = readline.createInterface({
    input: fs.createReadStream(inputFile),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let point;
    try {
      point = JSON.parse(line);
    } catch (e) {
      continue;
    }
    if (point.type !== 'Point' || !point.data) continue;

    const time = new Date(point.data.time).getTime();
    if (firstTime === null || time < firstTime) firstTime = time;
    if (lastTime === null || time > lastTime) lastTime = time;

    const tags = point.data.tags || {};
    const value = point.data.value;

    switch (point.metric) {
      case 'http_reqs': {
        getOrCreate(endpointFor(tags)).samples += 1;
        break;
      }
      case 'http_req_duration': {
        getOrCreate(endpointFor(tags)).durations.push(value);
        durationPoints.push({ time, value });
        break;
      }
      case 'http_req_failed': {
        if (value === 1) {
          const name = endpointFor(tags);
          getOrCreate(name).fails += 1;
          accumulateError(errorBuckets, {
            status: tags.status || 'n/a',
            endpoint: name,
            method: tags.method || 'GET',
            timestamp: time,
          });
        }
        break;
      }
      case 'data_sent': {
        totalSentBytes += value;
        break;
      }
      case 'data_received': {
        totalReceivedBytes += value;
        break;
      }
      case 'checks': {
        if (value === 1) checksPass += 1;
        else checksFail += 1;
        break;
      }
      case 'vus': {
        vuPoints.push({ time, value });
        if (value > vusMax) vusMax = value;
        break;
      }
      default:
        break;
    }
  }

  return {
    endpoints,
    errorBuckets,
    vuPoints,
    durationPoints,
    checksPass,
    checksFail,
    firstTime,
    lastTime,
    vusMax,
    totalSentBytes,
    totalReceivedBytes,
  };
}

function bucketDurations(durationPoints, firstTime, lastTime, bucketCount = 30) {
  if (durationPoints.length === 0 || firstTime === null || lastTime === null || lastTime <= firstTime) {
    return { labels: [], avgMs: [] };
  }
  const span = lastTime - firstTime;
  const bucketSizeMs = Math.max(1000, Math.ceil(span / bucketCount));
  const sums = new Map();
  const counts = new Map();
  for (const p of durationPoints) {
    const bucket = Math.floor((p.time - firstTime) / bucketSizeMs);
    sums.set(bucket, (sums.get(bucket) || 0) + p.value);
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  }
  const totalBuckets = Math.floor(span / bucketSizeMs) + 1;
  const labels = [];
  const avgMs = [];
  for (let b = 0; b < totalBuckets; b += 1) {
    labels.push(`${((b * bucketSizeMs) / 1000).toFixed(0)}s`);
    avgMs.push(counts.has(b) ? +(sums.get(b) / counts.get(b)).toFixed(1) : null);
  }
  return { labels, avgMs };
}

function buildEndpointRows(endpoints, testDurationSeconds) {
  const rows = [];
  let totalSamples = 0;
  let totalFails = 0;
  const allDurations = [];

  for (const [name, entry] of endpoints.entries()) {
    if (entry.samples === 0) continue; // e.g. stray tags with no actual request recorded
    const sorted = [...entry.durations].sort((a, b) => a - b);
    const avg = sorted.length ? sorted.reduce((s, v) => s + v, 0) / sorted.length : 0;
    const min = sorted.length ? sorted[0] : 0;
    const max = sorted.length ? sorted[sorted.length - 1] : 0;
    const median = percentile(sorted, 50);
    const p90 = percentile(sorted, 90);
    const p95 = percentile(sorted, 95);
    const errorPct = entry.samples ? (entry.fails / entry.samples) * 100 : 0;
    const throughput = testDurationSeconds > 0 ? entry.samples / testDurationSeconds : 0;

    totalSamples += entry.samples;
    totalFails += entry.fails;
    allDurations.push(...sorted);

    rows.push({ name, samples: entry.samples, fails: entry.fails, errorPct, avg, min, max, median, p90, p95, throughput });
  }

  rows.sort((a, b) => b.samples - a.samples);

  const allSorted = allDurations.sort((a, b) => a - b);
  const totals = {
    samples: totalSamples,
    fails: totalFails,
    errorPct: totalSamples ? (totalFails / totalSamples) * 100 : 0,
    avg: allSorted.length ? allSorted.reduce((s, v) => s + v, 0) / allSorted.length : 0,
    min: allSorted.length ? allSorted[0] : 0,
    max: allSorted.length ? allSorted[allSorted.length - 1] : 0,
    median: percentile(allSorted, 50),
    p90: percentile(allSorted, 90),
    p95: percentile(allSorted, 95),
    throughput: testDurationSeconds > 0 ? totalSamples / testDurationSeconds : 0,
  };

  return { rows, totals };
}

function renderEndpointTable(rows, totals) {
  const rowsHtml = rows
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.name)}</td>
        <td>${r.samples}</td>
        <td>${r.fails}</td>
        <td class="${r.errorPct > 0 ? 'danger' : ''}">${r.errorPct.toFixed(2)}%</td>
        <td>${formatMs(r.avg)}</td>
        <td>${formatMs(r.min)}</td>
        <td>${formatMs(r.max)}</td>
        <td>${formatMs(r.median)}</td>
        <td>${formatMs(r.p90)}</td>
        <td>${formatMs(r.p95)}</td>
        <td>${r.throughput.toFixed(2)}/s</td>
      </tr>`
    )
    .join('');

  return `
    <div class="section">
      <h2>Endpoint Summary</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Endpoint</th><th>Samples</th><th>Fails</th><th>Error %</th>
              <th>Avg</th><th>Min</th><th>Max</th><th>Median</th><th>p90</th><th>p95</th>
              <th>Throughput</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            <tr class="total-row">
              <td>TOTAL</td>
              <td>${totals.samples}</td>
              <td>${totals.fails}</td>
              <td class="${totals.errorPct > 0 ? 'danger' : ''}">${totals.errorPct.toFixed(2)}%</td>
              <td>${formatMs(totals.avg)}</td>
              <td>${formatMs(totals.min)}</td>
              <td>${formatMs(totals.max)}</td>
              <td>${formatMs(totals.median)}</td>
              <td>${formatMs(totals.p90)}</td>
              <td>${formatMs(totals.p95)}</td>
              <td>${totals.throughput.toFixed(2)}/s</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="note">Redirect hops (e.g. 307s) count as separate samples of the same endpoint, since k6 tags them with the original request's name.</p>
    </div>`;
}

function renderSummaryCards({ label, testDurationSeconds, totals, checksPass, checksFail, vusMax, totalSentBytes, totalReceivedBytes }) {
  const checksTotal = checksPass + checksFail;
  const checkRate = checksTotal ? (checksPass / checksTotal) * 100 : 100;
  const cardClass = (ok) => (ok ? 'card good' : 'card danger');

  return `
    <div class="cards">
      <div class="card"><div class="card-label">Test</div><div class="card-value">${escapeHtml(label)}</div></div>
      <div class="card"><div class="card-label">Duration</div><div class="card-value">${(testDurationSeconds / 60).toFixed(1)} min</div></div>
      <div class="card"><div class="card-label">Max VUs</div><div class="card-value">${vusMax}</div></div>
      <div class="card"><div class="card-label">Requests</div><div class="card-value">${totals.samples}</div></div>
      <div class="${cardClass(totals.errorPct < 1)}"><div class="card-label">Error rate</div><div class="card-value">${totals.errorPct.toFixed(2)}%</div></div>
      <div class="${cardClass(checkRate === 100)}"><div class="card-label">Checks passed</div><div class="card-value">${checkRate.toFixed(1)}%</div></div>
      <div class="card"><div class="card-label">p95 latency</div><div class="card-value">${formatMs(totals.p95)}</div></div>
      <div class="card"><div class="card-label">Data sent</div><div class="card-value">${formatKB(totalSentBytes)}</div></div>
      <div class="card"><div class="card-label">Data received</div><div class="card-value">${formatKB(totalReceivedBytes)}</div></div>
    </div>`;
}

function renderCharts({ vuPoints, firstTime, bucketed, errorBuckets }) {
  const vuLabels = vuPoints.map((p) => `${((p.time - firstTime) / 1000).toFixed(0)}s`);
  const vuValues = vuPoints.map((p) => p.value);

  const errorLabels = [...errorBuckets.values()].map((e) => `${e.status} ${e.endpoint}`);
  const errorCounts = [...errorBuckets.values()].map((e) => e.count);

  const errorChartBox = errorBuckets.size
    ? `<div class="chart-box"><h3>Errors by endpoint</h3><canvas id="errorChart"></canvas></div>`
    : '';

  const errorChartScript = errorBuckets.size
    ? `new Chart(document.getElementById('errorChart'), {
        type: 'bar',
        data: { labels: ${JSON.stringify(errorLabels)}, datasets: [{ label: 'Error count', data: ${JSON.stringify(errorCounts)}, backgroundColor: '#ef4444' }] },
        options: { responsive: true, scales: { y: { beginAtZero: true } } },
      });`
    : '';

  return `
    <div class="section">
      <h2>Charts</h2>
      <div class="chart-grid">
        <div class="chart-box">
          <h3>Virtual users over time</h3>
          <canvas id="vuChart"></canvas>
        </div>
        <div class="chart-box">
          <h3>Avg response time over time</h3>
          <canvas id="durationChart"></canvas>
        </div>
        ${errorChartBox}
      </div>
    </div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
    <script>
      new Chart(document.getElementById('vuChart'), {
        type: 'line',
        data: { labels: ${JSON.stringify(vuLabels)}, datasets: [{ label: 'VUs', data: ${JSON.stringify(vuValues)}, borderColor: '#6366f1', tension: 0.2, pointRadius: 0 }] },
        options: { responsive: true, scales: { y: { beginAtZero: true } } },
      });
      new Chart(document.getElementById('durationChart'), {
        type: 'line',
        data: { labels: ${JSON.stringify(bucketed.labels)}, datasets: [{ label: 'Avg duration (ms)', data: ${JSON.stringify(bucketed.avgMs)}, borderColor: '#0ea5e9', tension: 0.2, pointRadius: 0, spanGaps: true }] },
        options: { responsive: true, scales: { y: { beginAtZero: true } } },
      });
      ${errorChartScript}
    </script>`;
}

function renderPage({ label, generatedAt, cardsHtml, chartsHtml, tableHtml, errorHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>vidrush-k6 report — ${escapeHtml(label)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #f3f4f6; color: #111827; }
  header { background: linear-gradient(135deg, #4338ca, #0ea5e9); color: white; padding: 28px 32px; }
  header h1 { margin: 0 0 4px; font-size: 22px; }
  header .meta { opacity: 0.85; font-size: 13px; }
  .container { max-width: 1100px; margin: 0 auto; padding: 24px 32px 48px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 28px; }
  .card { background: white; border-radius: 10px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border-left: 4px solid #d1d5db; }
  .card.good { border-left-color: #22c55e; }
  .card.danger { border-left-color: #ef4444; }
  .card-label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; }
  .card-value { font-size: 20px; font-weight: 600; margin-top: 4px; }
  .section { background: white; border-radius: 10px; padding: 20px 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .section h2 { margin-top: 0; font-size: 16px; }
  .table-wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e5e7eb; white-space: nowrap; }
  th { color: #6b7280; font-weight: 600; font-size: 11px; text-transform: uppercase; }
  .total-row td { font-weight: 700; border-top: 2px solid #111827; }
  td.danger { color: #dc2626; font-weight: 600; }
  .ok-note { color: #16a34a; font-weight: 600; }
  .note { color: #6b7280; font-size: 12px; margin: 10px 0 0; }
  .chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; }
  .chart-box h3 { font-size: 13px; color: #374151; margin: 0 0 8px; }
</style>
</head>
<body>
<header>
  <h1>vidrush-k6 stress test report</h1>
  <div class="meta">${escapeHtml(label)} · generated ${generatedAt}</div>
</header>
<div class="container">
  ${cardsHtml}
  ${chartsHtml}
  ${tableHtml}
  ${errorHtml}
</div>
</body>
</html>`;
}

async function generateReport(inputFile, label = 'run', outDir = path.join(__dirname, '..', 'reports')) {
  const parsed = await parseNdjson(inputFile);
  const testDurationSeconds =
    parsed.firstTime !== null && parsed.lastTime !== null ? (parsed.lastTime - parsed.firstTime) / 1000 : 0;
  const { rows, totals } = buildEndpointRows(parsed.endpoints, testDurationSeconds);
  const bucketed = bucketDurations(parsed.durationPoints, parsed.firstTime, parsed.lastTime);

  const cardsHtml = renderSummaryCards({
    label,
    testDurationSeconds,
    totals,
    checksPass: parsed.checksPass,
    checksFail: parsed.checksFail,
    vusMax: parsed.vusMax,
    totalSentBytes: parsed.totalSentBytes,
    totalReceivedBytes: parsed.totalReceivedBytes,
  });
  const chartsHtml = renderCharts({
    vuPoints: parsed.vuPoints,
    firstTime: parsed.firstTime || 0,
    bucketed,
    errorBuckets: parsed.errorBuckets,
  });
  const tableHtml = renderEndpointTable(rows, totals);
  const errorHtml = renderErrorSection(parsed.errorBuckets);

  const html = renderPage({
    label,
    generatedAt: new Date().toLocaleString(),
    cardsHtml,
    chartsHtml,
    tableHtml,
    errorHtml,
  });

  const dateStamp = getDateStamp();
  const outPath = nextSequentialPath(outDir, label, dateStamp);
  fs.writeFileSync(outPath, html, 'utf8');
  return outPath;
}

async function main() {
  const [, , inputFile, label] = process.argv;
  if (!inputFile) {
    console.error('Usage: node generate-report.js <ndjson-file> [label]');
    process.exit(1);
  }
  if (!fs.existsSync(inputFile)) {
    console.error(`Input file not found: ${inputFile}`);
    process.exit(1);
  }
  const outPath = await generateReport(inputFile, label || path.basename(inputFile, path.extname(inputFile)));
  console.log(`Report written to ${outPath}`);
}

if (require.main === module) {
  main();
}

module.exports = { generateReport };
