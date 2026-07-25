const jsonHeaders = { "Content-Type": "application/json" };

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "Request failed.");
  }
  return data;
}

export async function getSession() {
  return parseResponse(await fetch("/api/session"));
}

export async function login(payload) {
  return parseResponse(
    await fetch("/api/login", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    }),
  );
}

export async function logout() {
  return parseResponse(await fetch("/api/logout", { method: "POST" }));
}

export async function getProfile() {
  return parseResponse(await fetch("/api/profile"));
}

export async function searchInstruments({ query, exchange = "NSE", limit = 25 }) {
  const params = new URLSearchParams({ query, exchange, limit });
  return parseResponse(await fetch(`/api/instrument-search?${params}`));
}

export async function getInstruments(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value).trim());
    }
  });
  return parseResponse(await fetch(`/api/instruments?${params}`));
}

export async function getSnapshot(payload) {
  return parseResponse(
    await fetch("/api/snapshot", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    }),
  );
}

export async function getHistorical(payload) {
  return parseResponse(
    await fetch("/api/historical", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    }),
  );
}

export async function runOptimizationBacktest(payload) {
  return parseResponse(
    await fetch("/api/optimization-backtest", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    }),
  );
}

export async function runStockScreeners() {
  return parseResponse(
    await fetch("/api/stock-screeners", {
      method: "POST",
      headers: jsonHeaders,
    }),
  );
}

export async function getStockScreenerChart({ ticker, screener }) {
  const query = new URLSearchParams({
    ticker,
    screener,
  });
  return parseResponse(await fetch(`/api/stock-screener-chart?${query.toString()}`));
}

export async function getOrders() {
  return parseResponse(await fetch("/api/orders"));
}

export async function placeOrder(payload) {
  return parseResponse(
    await fetch("/api/orders/place", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    }),
  );
}

export async function modifyOrder(payload) {
  return parseResponse(
    await fetch("/api/orders/modify", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    }),
  );
}

export async function cancelOrder(payload) {
  return parseResponse(
    await fetch("/api/orders/cancel", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    }),
  );
}

export async function getOrderHistory(orderId) {
  return parseResponse(await fetch(`/api/orders/${encodeURIComponent(orderId)}/history`));
}

export async function getOrderTrades(orderId) {
  return parseResponse(await fetch(`/api/orders/${encodeURIComponent(orderId)}/trades`));
}

export async function getPortfolio() {
  return parseResponse(await fetch("/api/portfolio"));
}
