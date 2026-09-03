'use strict';

/**
 * Records one failed-request observation into the error tracking buckets.
 * Buckets are keyed so identical failures (same status/endpoint/method) roll
 * up into a single row with a count, instead of one row per occurrence.
 */
function accumulateError(buckets, { status, endpoint, method, timestamp }) {
  const key = `${status}::${endpoint}::${method}`;
  const existing = buckets.get(key);
  if (existing) {
    existing.count += 1;
    if (timestamp < existing.firstSeen) existing.firstSeen = timestamp;
    if (timestamp > existing.lastSeen) existing.lastSeen = timestamp;
  } else {
    buckets.set(key, {
      status,
      endpoint,
      method,
      count: 1,
      firstSeen: timestamp,
      lastSeen: timestamp,
    });
  }
}

function renderErrorSection(buckets) {
  if (buckets.size === 0) {
    return '<div class="section"><h2>Errors</h2><p class="ok-note">No failed requests were recorded during this run.</p></div>';
  }

  const rows = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .map(
      (e) => `
        <tr>
          <td>${escapeHtml(e.status)}</td>
          <td>${escapeHtml(e.endpoint)}</td>
          <td>${escapeHtml(e.method)}</td>
          <td>${e.count}</td>
          <td>${new Date(e.firstSeen).toLocaleTimeString()}</td>
          <td>${new Date(e.lastSeen).toLocaleTimeString()}</td>
        </tr>`
    )
    .join('');

  return `
    <div class="section">
      <h2>Errors Detected</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Status</th><th>Endpoint</th><th>Method</th><th>Count</th><th>First seen</th><th>Last seen</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

module.exports = { accumulateError, renderErrorSection, escapeHtml };
