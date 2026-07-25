import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  cancelOrder,
  getInstruments,
  getHistorical,
  getOrderHistory,
  getOrders,
  getOrderTrades,
  getPortfolio,
  getProfile,
  getSession,
  getSnapshot,
  getStockScreenerChart,
  login,
  logout,
  modifyOrder,
  placeOrder,
  runOptimizationBacktest,
  runStockScreeners,
  searchInstruments,
} from "./api";
import "./styles.css";

const TABS = [
  ["user", "User"],
  ["instruments", "Instruments"],
  ["snapshot", "Snapshot"],
  ["historical", "Historical"],
  ["stockScreener", "Stock Screener"],
  ["optimization", "Optimization"],
  ["realtime", "Realtime"],
  ["orders", "Orders"],
  ["portfolio", "Positions & P&L"],
];

const NAV_SECTIONS = [
  {
    title: null,
    tabs: [
      ["user", "User"],
    ],
  },
  {
    title: "Instruments",
    tabs: [
      ["instruments", "Instruments"],
    ],
  },
  {
    title: "Data",
    tabs: [
      ["snapshot", "Snapshot"],
      ["realtime", "Realtime"],
      ["historical", "Historical"],
    ],
  },
  {
    title: "Screener",
    tabs: [
      ["stockScreener", "Stock Screener"],
    ],
  },
  {
    title: "Backtest",
    tabs: [
      ["optimization", "Optimization"],
    ],
  },
  {
    title: "Portfolio",
    tabs: [
      ["orders", "Orders"],
      ["portfolio", "Positions & P&L"],
    ],
  },
];

const INTERVALS = ["minute", "3minute", "5minute", "10minute", "15minute", "30minute", "60minute", "day"];
const MA_PERIODS = [3, 5, 6, 9, 10, 12, 15, 20, 30, 50, 100, 200];
const LOGIN_DEFAULTS_KEY = "varsity-kite-uat-login-defaults";
const OPTIMIZATION_BACKTEST_DEFAULTS = {
  tradingsymbol: "NIFTYBEES",
  from_date: daysAgo(365 * 5),
  to_date: today(),
  short_sma: 10,
  long_sma: 30,
  initial_capital: 500000,
  stop_loss_pct: 1,
  take_profit_pct: 5,
};
const STOCK_SCREENER_CARDS = [
  {
    key: "near_52_week_high",
    title: "Near 52-Week High",
    description: "Within 5% below the prior 252-day high, excluding recent highs.",
    valueLabel: "52W High",
    metricLabel: "Distance %",
    metricType: "percent",
  },
  {
    key: "daily_volume_breakout",
    title: "Daily Volume Breakout",
    description: "Current daily volume versus the previous 22 completed sessions.",
    valueLabel: "Current Volume",
    metricLabel: "Volume Ratio",
    metricType: "ratio",
  },
  {
    key: "weekly_volume_breakout",
    title: "Weekly Volume Breakout",
    description: "Current week cumulative volume versus the previous 52 completed weeks.",
    valueLabel: "Week Volume",
    metricLabel: "Weekly Ratio",
    metricType: "ratio",
  },
  {
    key: "near_52_week_low",
    title: "Near 52-Week Low",
    description: "Within 5% above the prior 252-day low, excluding recent lows.",
    valueLabel: "52W Low",
    metricLabel: "Distance %",
    metricType: "percent",
  },
];

function readLoginDefaults() {
  try {
    return JSON.parse(window.localStorage.getItem(LOGIN_DEFAULTS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveLoginDefaults(form) {
  window.localStorage.setItem(
    LOGIN_DEFAULTS_KEY,
    JSON.stringify({
      api_key: form.api_key,
      user_id: form.user_id,
    }),
  );
}

function dateValue(date) {
  return date.toISOString().slice(0, 10);
}

function daysAgo(days) {
  const value = new Date();
  value.setDate(value.getDate() - days);
  return dateValue(value);
}

function today() {
  return dateValue(new Date());
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("en-IN", { maximumFractionDigits: digits });
}

function roundToTick(value, tick = 0.05, direction = "nearest") {
  const price = Number(value);
  const tickSize = Number(tick) || 0.05;
  if (!Number.isFinite(price) || price <= 0) return 0;
  if (direction === "up") return Math.ceil(price / tickSize) * tickSize;
  if (direction === "down") return Math.floor(price / tickSize) * tickSize;
  return Math.round(price / tickSize) * tickSize;
}

function aggressiveLimitPrice(ltp, transactionType) {
  const rawPrice = transactionType === "BUY" ? Number(ltp) * 1.01 : Number(ltp) * 0.99;
  const rounded = roundToTick(rawPrice, 0.05, transactionType === "BUY" ? "up" : "down");
  return Number(rounded.toFixed(2));
}

function quoteLimitPrice(quote, transactionType) {
  const depthSide = transactionType === "BUY" ? "sell" : "buy";
  const bestLevel = quote?.depth?.[depthSide]?.[0];
  const bestPrice = Number(bestLevel?.price);
  if (Number.isFinite(bestPrice) && bestPrice > 0) {
    return {
      price: Number(roundToTick(bestPrice, 0.05).toFixed(2)),
      source: transactionType === "BUY" ? "best ask" : "best bid",
    };
  }
  const ltp = Number(quote?.last_price);
  if (!Number.isFinite(ltp) || ltp <= 0) {
    throw new Error("Quote did not include market depth or LTP.");
  }
  return {
    price: aggressiveLimitPrice(ltp, transactionType),
    source: "LTP fallback",
  };
}

function formatCurrency(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(number);
}

function formatList(items) {
  const values = (items || []).filter(Boolean);
  if (!values.length) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function movingAverage(values, period) {
  const result = [];
  let runningSum = 0;
  values.forEach((value, index) => {
    runningSum += value;
    if (index >= period) runningSum -= values[index - period];
    result.push(index >= period - 1 ? runningSum / period : null);
  });
  return result;
}

function positionKey(row) {
  return `${row.exchange || "NSE"}:${row.tradingsymbol}`;
}

function liveLtpForRow(row, liveTicks) {
  const token = String(row.instrument_token || "");
  const live = token ? liveTicks[token]?.last_price : null;
  const price = Number(live ?? row.last_price);
  return Number.isFinite(price) ? price : 0;
}

function positionPnl(row, liveTicks) {
  const livePrice = liveLtpForRow(row, liveTicks);
  const quantity = asNumber(row.quantity);
  const multiplier = asNumber(row.multiplier) || 1;
  const buyValue = asNumber(row.buy_value);
  const sellValue = asNumber(row.sell_value);
  if (livePrice > 0 && (buyValue || sellValue || quantity)) {
    return Number((sellValue - buyValue + quantity * livePrice * multiplier).toFixed(2));
  }
  return asNumber(row.pnl);
}

function holdingPnl(row, liveTicks) {
  const livePrice = liveLtpForRow(row, liveTicks);
  const quantity = asNumber(row.quantity);
  const averagePrice = asNumber(row.average_price);
  if (livePrice > 0 && quantity && averagePrice) {
    return Number(((livePrice - averagePrice) * quantity).toFixed(2));
  }
  return asNumber(row.pnl);
}

function openPositionTokens(portfolio) {
  const rows = [...(portfolio?.positions?.net || []), ...(portfolio?.positions?.day || [])];
  return [
    ...new Set(
      rows
        .filter((row) => asNumber(row.quantity) !== 0 && Number(row.instrument_token))
        .map((row) => Number(row.instrument_token)),
    ),
  ];
}

function buildLivePortfolio(portfolio, liveTicks) {
  if (!portfolio) return { pnl: {}, netRows: [], dayRows: [], holdingRows: [], streamedTokens: [] };
  const netRows = (portfolio.positions?.net || []).map((row) => ({
    ...row,
    live_last_price: liveLtpForRow(row, liveTicks) || row.last_price,
    live_pnl: positionPnl(row, liveTicks),
    is_live: Boolean(liveTicks[String(row.instrument_token || "")]?.last_price),
  }));
  const dayRows = (portfolio.positions?.day || []).map((row) => ({
    ...row,
    live_last_price: liveLtpForRow(row, liveTicks) || row.last_price,
    live_pnl: positionPnl(row, liveTicks),
    is_live: Boolean(liveTicks[String(row.instrument_token || "")]?.last_price),
  }));
  const holdingRows = (portfolio.holdings || []).map((row) => ({
    ...row,
    live_last_price: liveLtpForRow(row, liveTicks) || row.last_price,
    live_pnl: holdingPnl(row, liveTicks),
    is_live: Boolean(liveTicks[String(row.instrument_token || "")]?.last_price),
  }));
  const netPositionPnl = netRows.reduce((sum, row) => sum + asNumber(row.live_pnl), 0);
  const dayPositionPnl = dayRows.reduce((sum, row) => sum + asNumber(row.live_pnl), 0);
  const holdingTotalPnl = holdingRows.reduce((sum, row) => sum + asNumber(row.live_pnl), 0);
  return {
    pnl: {
      ...portfolio.pnl,
      combined_pnl: Number((netPositionPnl + holdingTotalPnl).toFixed(2)),
      net_position_pnl: Number(netPositionPnl.toFixed(2)),
      day_position_pnl: Number(dayPositionPnl.toFixed(2)),
      holding_pnl: Number(holdingTotalPnl.toFixed(2)),
    },
    netRows,
    dayRows,
    holdingRows,
    streamedTokens: openPositionTokens(portfolio),
  };
}

function portfolioForInstrumentKeys(portfolio, instrumentKeys) {
  const keys = new Set(instrumentKeys);
  if (!portfolio || !keys.size) return { positions: { net: [], day: [] }, holdings: [], pnl: {}, errors: [] };
  return {
    ...portfolio,
    positions: {
      net: (portfolio.positions?.net || []).filter((row) => keys.has(positionKey(row))),
      day: (portfolio.positions?.day || []).filter((row) => keys.has(positionKey(row))),
    },
    holdings: (portfolio.holdings || []).filter((row) => keys.has(positionKey(row))),
  };
}

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateOnly(value) {
  if (!value) return "-";
  const text = String(value);
  const datePart = text.slice(0, 10);
  const parsed = new Date(`${datePart}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function JsonBlock({ data }) {
  return (
    <section className="json-block">
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </section>
  );
}

function InstrumentPicker({ onPick, selected = [], placeholder = "Search symbol, e.g. INFY" }) {
  const [query, setQuery] = useState("");
  const [exchange, setExchange] = useState("NSE");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const searchText = query.trim();
    if (searchText.length < 2) {
      setResults([]);
      setError("");
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setError("");
      setLoading(true);
      try {
        const response = await searchInstruments({ query: searchText, exchange, limit: 30 });
        if (!cancelled) setResults(response.instruments || []);
      } catch (searchError) {
        if (!cancelled) setError(searchError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, exchange]);

  async function runSearch(event) {
    event?.preventDefault();
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setError("");
    setLoading(true);
    try {
      const response = await searchInstruments({ query: query.trim(), exchange, limit: 30 });
      setResults(response.instruments || []);
    } catch (searchError) {
      setError(searchError.message);
    } finally {
      setLoading(false);
    }
  }

  function pickInstrument(instrument) {
    onPick(instrument);
    setQuery("");
    setResults([]);
    setError("");
  }

  return (
    <div className="instrument-picker">
      <form className="search-row" onSubmit={runSearch}>
        <select value={exchange} onChange={(event) => setExchange(event.target.value)}>
          <option value="NSE">NSE</option>
          <option value="BSE">BSE</option>
          <option value="NFO">NFO</option>
          <option value="BFO">BFO</option>
          <option value="MCX">MCX</option>
        </select>
        <input value={query} placeholder={placeholder} autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
        <button className="secondary-button" type="submit" disabled={loading}>
          {loading ? "Searching" : "Refresh"}
        </button>
      </form>
      {error ? <div className="error-box">{error}</div> : null}
      {selected.length ? (
        <div className="chips">
          {selected.map((item) => (
            <span key={item.instrument_token || item.instrument_key}>{item.instrument_key}</span>
          ))}
        </div>
      ) : null}
      {results.length ? (
        <div className="picker-results">
          {results.map((instrument) => (
            <button
              key={`${instrument.exchange}-${instrument.instrument_token}`}
              type="button"
              onClick={() => pickInstrument(instrument)}
            >
              <strong>{instrument.instrument_key}</strong>
              <span>{instrument.name || instrument.instrument_type || instrument.segment}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LoginPage({ onLoggedIn, session }) {
  const defaults = readLoginDefaults();
  const [form, setForm] = useState({
    api_key: session?.api_key || defaults.api_key || "sandboxdemo",
    api_secret: "sandboxdemo-secret",
    request_token: "",
    user_id: session?.user_id || defaults.user_id || "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const payload = {
        api_key: form.api_key,
        api_secret: form.api_secret,
        request_token: form.request_token,
      };
      const loginSession = await login(payload);
      saveLoginDefaults({ ...form, user_id: loginSession.user_id || form.user_id });
      onLoggedIn();
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="hero-panel login-guide-panel">
        <div className="brand-chip">ZERODHA VARSITY</div>
        <div className="login-hero-copy">
          <p>Kite sandbox</p>
          <h1>UAT Trading Dashboard</h1>
        </div>
        <section className="sandbox-login-guide hero-login-guide" aria-label="How to login to Kite sandbox">
          <div>
            <h2>How to login</h2>
            <p>
              Use any Kite sandbox client ID from <strong>DD1000</strong> to <strong>DD2999</strong>, then copy the request token from the final redirect URL.
            </p>
          </div>
          <div className="sandbox-credential-grid">
            <span><strong>Client ID</strong> DD1000 to DD2999</span>
            <span><strong>Password</strong> sandboxvarsity</span>
            <span><strong>PIN</strong> 123456</span>
          </div>
          <ol className="login-steps">
            <li>Click <strong>Open Sandbox Login</strong> on the right.</li>
            <li>Enter any client ID in the allowed range, for example <strong>DD1999</strong>.</li>
            <li>Use password <strong>sandboxvarsity</strong>, then enter PIN <strong>123456</strong>.</li>
            <li>After login succeeds, the browser redirects to a localhost URL containing <strong>request_token=</strong>.</li>
            <li>Copy only the token value after <strong>request_token=</strong> and paste it into the <strong>Request Token</strong> field on the right.</li>
            <li>Click <strong>Login</strong> to connect the UAT dashboard.</li>
          </ol>
          <div className="login-example-grid">
            <figure className="sandbox-login-example">
              <img src="/assets/sandbox-login.png" alt="Example Kite sandbox login screen" />
              <figcaption>Example sandbox login screen</figcaption>
            </figure>
            <figure className="sandbox-login-example request-token-example">
              <img src="/assets/request-token-uat.png" alt="Request token highlighted in the localhost redirect URL" />
              <figcaption>Copy the highlighted request token from the redirect URL</figcaption>
            </figure>
          </div>
        </section>
      </section>

      <section className="login-side">
        <form className="login-card" onSubmit={submit}>
          <div>
            <p className="eyebrow">Sandbox UAT login</p>
            <h2>Connect your Kite UAT session</h2>
            <p className="muted">
              Open the sandbox login page, copy the request token after login, and paste it below. The backend
              stores only API key, access token, and user ID locally.
            </p>
            <a className="login-link" href={session?.login_url || "https://sandbox.kite.trade/connect/login?api_key=sandboxdemo"} target="_blank" rel="noreferrer">
              Open Sandbox Login
            </a>
          </div>
          <label>
            <span>API Key</span>
            <input name="api_key" value={form.api_key} onChange={updateField} required />
          </label>
          <label>
            <span>API Secret</span>
            <input name="api_secret" type="password" value={form.api_secret} onChange={updateField} required />
          </label>
          <label>
            <span>Request Token</span>
            <input name="request_token" value={form.request_token} onChange={updateField} required />
          </label>
          {error ? <div className="error-box">{error}</div> : null}
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? "Saving" : "Login"}
          </button>
        </form>
      </section>
    </main>
  );
}

function UserTab() {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getProfile().then(setProfile).catch((profileError) => setError(profileError.message));
  }, []);

  if (error) return <div className="error-box">{error}</div>;
  if (!profile) return <div className="empty-box">Loading user profile...</div>;

  return (
    <div className="grid-view">
      {[
        ["User Name", profile.user_name],
        ["User ID", profile.user_id],
        ["Products", (profile.products || []).join(", ")],
        ["Exchanges", (profile.exchanges || []).join(", ")],
      ].map(([label, value]) => (
        <article className="metric-card" key={label}>
          <span>{label}</span>
          <strong>{value || "-"}</strong>
        </article>
      ))}
    </div>
  );
}

function InstrumentsTab() {
  const [filters, setFilters] = useState({ exchange: "NSE", instrument_type: "", query: "", limit: 100 });
  const [view, setView] = useState("clean");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function update(event) {
    setFilters((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function load(event) {
    event?.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await getInstruments(filters);
      setResult(response);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="stack">
      <form className="panel" onSubmit={load}>
        <h2>UAT instruments</h2>
        <div className="form-grid">
          <label>
            <span>Exchange</span>
            <select name="exchange" value={filters.exchange} onChange={update}>
              <option value="NSE">NSE</option>
              <option value="BSE">BSE</option>
              <option value="NFO">NFO</option>
              <option value="BFO">BFO</option>
              <option value="MCX">MCX</option>
            </select>
          </label>
          <label>
            <span>Type</span>
            <select name="instrument_type" value={filters.instrument_type} onChange={update}>
              <option value="">All</option>
              <option value="EQ">EQ</option>
              <option value="FUT">FUT</option>
              <option value="CE">CE</option>
              <option value="PE">PE</option>
            </select>
          </label>
          <label>
            <span>Search</span>
            <input name="query" value={filters.query} placeholder="HDFCBANK, RELIANCE..." onChange={update} />
          </label>
          <label>
            <span>Limit</span>
            <input name="limit" min="1" max="500" type="number" value={filters.limit} onChange={update} />
          </label>
        </div>
        <button className="primary-button" type="submit" disabled={loading}>
          {loading ? "Loading" : "Load Instruments"}
        </button>
      </form>
      {error ? <div className="error-box">{error}</div> : null}
      {result ? (
        <section className="panel">
          <div className="toolbar compact-toolbar">
            <ViewToggle value={view} onChange={setView} />
            <div className="muted">
              Matched {result.meta?.matched}, returned {result.meta?.returned}
            </div>
          </div>
          {view === "api" ? (
            <JsonBlock data={result} />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Instrument</th>
                    <th>Name</th>
                    <th>Token</th>
                    <th>Type</th>
                    <th>Segment</th>
                    <th>Expiry</th>
                    <th>Strike</th>
                    <th>Lot</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.instruments || []).map((row) => (
                    <tr key={`${row.exchange}-${row.instrument_token}`}>
                      <td className="ticker-cell">{row.instrument_key}</td>
                      <td>{row.name || "-"}</td>
                      <td>{row.instrument_token}</td>
                      <td>{row.instrument_type || "-"}</td>
                      <td>{row.segment || "-"}</td>
                      <td>{row.expiry || "-"}</td>
                      <td>{formatNumber(row.strike)}</td>
                      <td>{formatNumber(row.lot_size, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function SnapshotTab() {
  const [selected, setSelected] = useState([]);
  const [mode, setMode] = useState("ltp");
  const [view, setView] = useState("clean");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function addInstrument(instrument) {
    setSelected((current) => {
      if (current.some((item) => item.instrument_key === instrument.instrument_key)) return current;
      return [...current, instrument];
    });
  }

  async function fetchSnapshot() {
    setError("");
    if (!selected.length) {
      setError("Select at least one instrument.");
      return;
    }
    setLoading(true);
    try {
      const response = await getSnapshot({ mode, instruments: selected.map((item) => item.instrument_key) });
      setResult(response);
    } catch (snapshotError) {
      setError(snapshotError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack">
      <section className="panel">
        <h2>Snapshot data</h2>
        <InstrumentPicker selected={selected} onPick={addInstrument} />
        <div className="toolbar">
          <select value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="ltp">LTP</option>
            <option value="ohlc">OHLC</option>
            <option value="quote">Quote</option>
          </select>
          <button className="primary-button" onClick={fetchSnapshot} disabled={loading} type="button">
            {loading ? "Fetching" : "Fetch Snapshot"}
          </button>
          <button className="secondary-button" type="button" onClick={() => setSelected([])}>
            Clear
          </button>
        </div>
      </section>
      {error ? <div className="error-box">{error}</div> : null}
      {result ? (
        <section className="panel">
          <ViewToggle value={view} onChange={setView} />
          {view === "api" ? <JsonBlock data={result} /> : <SnapshotTable data={result.data} />}
        </section>
      ) : null}
    </div>
  );
}

function ViewToggle({ value, onChange }) {
  return (
    <div className="view-toggle">
      <button className={value === "clean" ? "active" : ""} type="button" onClick={() => onChange("clean")}>
        Clean Data
      </button>
      <button className={value === "api" ? "active" : ""} type="button" onClick={() => onChange("api")}>
        API Response
      </button>
    </div>
  );
}

function SnapshotTable({ data }) {
  const rows = Object.entries(data || {});
  if (!rows.length) return <div className="empty-box">No snapshot data yet.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Instrument</th>
            <th>LTP</th>
            <th>Open</th>
            <th>High</th>
            <th>Low</th>
            <th>Close</th>
            <th>Volume</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, value]) => (
            <tr key={key}>
              <td className="ticker-cell">{key}</td>
              <td>{formatNumber(value.last_price ?? value.last_price)}</td>
              <td>{formatNumber(value.ohlc?.open)}</td>
              <td>{formatNumber(value.ohlc?.high)}</td>
              <td>{formatNumber(value.ohlc?.low)}</td>
              <td>{formatNumber(value.ohlc?.close)}</td>
              <td>{formatNumber(value.volume, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OhlcvCanvas({ candles = [], title = "OHLCV chart", overlays = [] }) {
  const canvasRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const targetsRef = useRef([]);
  const rows = useMemo(
    () =>
      candles
        .map((row) => ({
          ...row,
          open: asNumber(row.open),
          high: asNumber(row.high),
          low: asNumber(row.low),
          close: asNumber(row.close),
          volume: asNumber(row.volume),
        }))
        .filter((row) => row.date && row.high && row.low),
    [candles],
  );
  const overlaySeries = useMemo(() => {
    const closes = rows.map((row) => row.close);
    return overlays.map((overlay) => ({
      ...overlay,
      values: movingAverage(closes, overlay.period),
    }));
  }, [rows, overlays]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rows.length) return undefined;

    function draw() {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(rect.width, 320);
      const height = Math.max(rect.height, 430);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);

      const padding = { left: 58, right: 18, top: 24, bottom: 42 };
      const volumeHeight = 86;
      const chartHeight = height - padding.top - padding.bottom - volumeHeight - 16;
      const plotWidth = width - padding.left - padding.right;
      const overlayValues = overlaySeries.flatMap((overlay) => overlay.values).filter((value) => Number.isFinite(value));
      const maxHigh = Math.max(...rows.map((row) => row.high), ...overlayValues);
      const minLow = Math.min(...rows.map((row) => row.low), ...overlayValues);
      const maxVolume = Math.max(...rows.map((row) => row.volume), 1);
      const pricePad = Math.max((maxHigh - minLow) * 0.08, 1);
      const yMax = maxHigh + pricePad;
      const yMin = minLow - pricePad;
      const xStep = plotWidth / Math.max(rows.length, 1);
      const candleWidth = Math.max(3, Math.min(14, xStep * 0.62));
      const priceY = (value) => padding.top + ((yMax - value) / (yMax - yMin || 1)) * chartHeight;
      const volumeTop = padding.top + chartHeight + 16;
      const targets = [];

      ctx.strokeStyle = "rgba(102,102,102,0.13)";
      ctx.fillStyle = "#666666";
      ctx.font = "12px Inter, system-ui, sans-serif";
      for (let index = 0; index <= 4; index += 1) {
        const y = padding.top + (chartHeight * index) / 4;
        const price = yMax - ((yMax - yMin) * index) / 4;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();
        ctx.fillText(price.toFixed(2), 8, y + 4);
      }

      rows.forEach((row, index) => {
        const x = padding.left + index * xStep + xStep / 2;
        const up = row.close >= row.open;
        const color = up ? "#4f9444" : "#cc0000";
        const openY = priceY(row.open);
        const closeY = priceY(row.close);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, priceY(row.high));
        ctx.lineTo(x, priceY(row.low));
        ctx.stroke();
        ctx.fillRect(x - candleWidth / 2, Math.min(openY, closeY), candleWidth, Math.max(Math.abs(openY - closeY), 1));
        const volumeBarHeight = (row.volume / maxVolume) * volumeHeight;
        ctx.globalAlpha = 0.28;
        ctx.fillRect(x - candleWidth / 2, volumeTop + volumeHeight - volumeBarHeight, candleWidth, volumeBarHeight);
        ctx.globalAlpha = 1;
        targets.push({
          x,
          row,
          overlays: overlaySeries
            .map((overlay) => ({ label: overlay.label, value: overlay.values[index] }))
            .filter((overlay) => Number.isFinite(overlay.value)),
        });
      });

      overlaySeries.forEach((overlay) => {
        ctx.strokeStyle = overlay.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        let started = false;
        overlay.values.forEach((value, index) => {
          if (!Number.isFinite(value)) return;
          const x = padding.left + index * xStep + xStep / 2;
          const y = priceY(value);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        });
        ctx.stroke();
      });

      overlaySeries.forEach((overlay, index) => {
        const x = padding.left + index * 116;
        const y = padding.top + 14;
        ctx.fillStyle = overlay.color;
        ctx.fillRect(x, y - 8, 22, 3);
        ctx.fillStyle = "#666666";
        ctx.fillText(overlay.label, x + 28, y - 4);
      });

      ctx.fillStyle = "#666666";
      ctx.fillText(rows[0]?.date || "", padding.left, height - 14);
      ctx.fillText(rows[rows.length - 1]?.date || "", Math.max(padding.left, width - 110), height - 14);
      targetsRef.current = targets;
    }

    draw();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(draw);
    if (observer) observer.observe(canvas);
    return () => observer?.disconnect();
  }, [rows, overlaySeries]);

  function onMove(event) {
    const canvas = canvasRef.current;
    if (!canvas || !targetsRef.current.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const nearest = targetsRef.current.reduce((best, item) => {
      const distance = Math.abs(item.x - x);
      return !best || distance < best.distance ? { ...item, distance } : best;
    }, null);
    if (!nearest || nearest.distance > 18) {
      setTooltip(null);
      return;
    }
    setTooltip({
      ...nearest.row,
      overlays: nearest.overlays,
      left: Math.min(Math.max(nearest.x + 12, 12), rect.width - 240),
      top: 18,
    });
  }

  if (!rows.length) return <div className="empty-box">No candles to chart yet.</div>;
  return (
    <section className="chart-card">
      <div className="chart-title">{title}</div>
      <div className="chart-shell">
        <canvas ref={canvasRef} onMouseMove={onMove} onMouseLeave={() => setTooltip(null)} />
        {tooltip ? (
          <div className="chart-tooltip" style={{ left: tooltip.left, top: tooltip.top }}>
            <strong>{formatDateTime(tooltip.date)}</strong>
            <span>Open {formatNumber(tooltip.open)}</span>
            <span>High {formatNumber(tooltip.high)}</span>
            <span>Low {formatNumber(tooltip.low)}</span>
            <span>Close {formatNumber(tooltip.close)}</span>
            <span>Volume {formatNumber(tooltip.volume, 0)}</span>
            {(tooltip.overlays || []).map((overlay) => (
              <span key={overlay.label}>{overlay.label} {formatNumber(overlay.value)}</span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function HistoricalTab() {
  const [instrument, setInstrument] = useState(null);
  const [settings, setSettings] = useState({ interval: "day", from_date: daysAgo(365), to_date: today(), oi: false, continuous: false });
  const [view, setView] = useState("clean");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function update(event) {
    const { name, value, type, checked } = event.target;
    setSettings((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
  }

  async function fetchData(event) {
    event.preventDefault();
    setError("");
    if (!instrument) {
      setError("Select an instrument first.");
      return;
    }
    setLoading(true);
    try {
      const response = await getHistorical({
        ...settings,
        instrument_token: instrument.instrument_token,
        tradingsymbol: instrument.tradingsymbol,
        exchange: instrument.exchange,
      });
      setResult(response);
    } catch (historicalError) {
      setError(historicalError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack">
      <form className="panel" onSubmit={fetchData}>
        <h2>Historical data</h2>
        <InstrumentPicker selected={instrument ? [instrument] : []} onPick={setInstrument} />
        <div className="form-grid">
          <label>
            <span>Interval</span>
            <select name="interval" value={settings.interval} onChange={update}>
              {INTERVALS.map((interval) => <option key={interval}>{interval}</option>)}
            </select>
          </label>
          <label>
            <span>From</span>
            <input name="from_date" type="date" value={settings.from_date} onChange={update} />
          </label>
          <label>
            <span>To</span>
            <input name="to_date" type="date" value={settings.to_date} onChange={update} />
          </label>
          <label className="checkbox-field">
            <input name="oi" type="checkbox" checked={settings.oi} onChange={update} />
            <span>Include OI</span>
          </label>
          <label className="checkbox-field">
            <input name="continuous" type="checkbox" checked={settings.continuous} onChange={update} />
            <span>Continuous futures</span>
          </label>
        </div>
        <button className="primary-button" type="submit" disabled={loading}>
          {loading ? "Fetching" : "Fetch Historical"}
        </button>
      </form>
      {error ? <div className="error-box">{error}</div> : null}
      {result ? (
        <section className="panel">
          <ViewToggle value={view} onChange={setView} />
          {view === "api" ? (
            <JsonBlock data={result} />
          ) : (
            <div className="stack">
              <OhlcvCanvas candles={result.candles || []} title={`${result.instrument.tradingsymbol} OHLCV`} />
              <CandleTailTable candles={result.candles || []} />
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function CandleTailTable({ candles }) {
  const rows = (candles || []).slice(-10).reverse();
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Open</th>
            <th>High</th>
            <th>Low</th>
            <th>Close</th>
            <th>Volume</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.date}-${index}`}>
              <td>{formatDateTime(row.date)}</td>
              <td>{formatNumber(row.open)}</td>
              <td>{formatNumber(row.high)}</td>
              <td>{formatNumber(row.low)}</td>
              <td>{formatNumber(row.close)}</td>
              <td>{formatNumber(row.volume, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatScreenerValue(value, type) {
  if (type === "percent") return `${formatNumber(value)}%`;
  if (type === "ratio") return `${formatNumber(value)}x`;
  return formatNumber(value);
}

function stockScreenerSignalCopy(config, signal) {
  if (!signal) return "No current signal for the selected screener.";
  if (config.key === "near_52_week_high") {
    return `${signal.ticker} is ${formatNumber(signal.metric_value)}% below its prior 252-session high.`;
  }
  if (config.key === "near_52_week_low") {
    return `${signal.ticker} is ${formatNumber(signal.metric_value)}% above its prior 252-session low.`;
  }
  if (config.key === "weekly_volume_breakout") {
    const suffix = signal.current_week_incomplete ? " The current week is still in progress." : "";
    return `${signal.ticker} is trading at ${formatNumber(signal.metric_value)}x its 52-week average volume.${suffix}`;
  }
  return `${signal.ticker} is trading at ${formatNumber(signal.metric_value)}x its 22-session average volume.`;
}

function ScreenerResultTable({ config, rows, onSelect }) {
  return (
    <div className="table-wrap screener-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Ticker</th>
            <th>Company</th>
            <th>Price</th>
            <th>{config.valueLabel}</th>
            <th>{config.metricLabel}</th>
            <th>Change</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {(rows || []).map((row) => (
            <tr key={`${config.key}-${row.ticker}`} onClick={() => onSelect?.(config.key, row.ticker)}>
              <td>{row.rank}</td>
              <td className="ticker-cell">{row.ticker}</td>
              <td>{row.company || "-"}</td>
              <td>{formatNumber(row.current_price)}</td>
              <td>
                {formatNumber(row.reference_value, 0)}
                {row.comparison_value ? <span className="comparison-value"> vs {formatNumber(row.comparison_value, 0)}</span> : null}
              </td>
              <td>{formatScreenerValue(row.metric_value, config.metricType)}</td>
              <td>{row.price_change_pct === null || row.price_change_pct === undefined ? "-" : `${formatNumber(row.price_change_pct)}%`}</td>
              <td>{row.relevant_date || "-"}</td>
            </tr>
          ))}
          {!rows?.length ? <tr><td colSpan="8" className="empty-cell">No matching stocks in this run.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function StockScreenerChartPanel({ result, selected, onSelect }) {
  const [activeScreener, setActiveScreener] = useState(selected?.screener || STOCK_SCREENER_CARDS[0].key);
  const [selectedTicker, setSelectedTicker] = useState(selected?.ticker || "");
  const [chartData, setChartData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const config = STOCK_SCREENER_CARDS.find((item) => item.key === activeScreener) || STOCK_SCREENER_CARDS[0];
  const rows = result?.screeners?.[activeScreener] || [];
  const tickers = rows.map((row) => row.ticker);

  useEffect(() => {
    setActiveScreener(selected?.screener || STOCK_SCREENER_CARDS[0].key);
    setSelectedTicker(selected?.ticker || "");
  }, [selected]);

  useEffect(() => {
    if (!rows.length) {
      setSelectedTicker("");
      return;
    }
    if (!selectedTicker || !tickers.includes(selectedTicker)) {
      setSelectedTicker(rows[0].ticker);
    }
  }, [activeScreener, rows, selectedTicker, tickers]);

  useEffect(() => {
    if (!selectedTicker) {
      setChartData(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    getStockScreenerChart({ ticker: selectedTicker, screener: activeScreener })
      .then((response) => {
        if (!cancelled) setChartData(response);
      })
      .catch((chartError) => {
        if (!cancelled) {
          setChartData(null);
          setError(chartError.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeScreener, selectedTicker]);

  if (!result) return null;

  function changeScreener(key) {
    const nextRows = result?.screeners?.[key] || [];
    const nextTicker = nextRows[0]?.ticker || "";
    setActiveScreener(key);
    setSelectedTicker(nextTicker);
    onSelect?.({ screener: key, ticker: nextTicker });
  }

  function changeTicker(event) {
    const ticker = event.target.value;
    setSelectedTicker(ticker);
    onSelect?.({ screener: activeScreener, ticker });
  }

  return (
    <section className="panel stock-screener-chart-panel">
      <div className="compact-toolbar">
        <div>
          <h2>Screener chart</h2>
          <p className="muted">{config.description}</p>
        </div>
        <label className="compact-select">
          <span>Ticker</span>
          <select value={selectedTicker} onChange={changeTicker} disabled={!rows.length}>
            {rows.map((row) => <option key={row.ticker} value={row.ticker}>{row.ticker}</option>)}
          </select>
        </label>
      </div>
      <div className="view-toggle screener-tabs">
        {STOCK_SCREENER_CARDS.map((item) => (
          <button className={activeScreener === item.key ? "active" : ""} key={item.key} type="button" onClick={() => changeScreener(item.key)}>
            {item.title}
          </button>
        ))}
      </div>
      {error ? <div className="error-box">{error}</div> : null}
      {chartData?.signal ? (
        <div className="stock-chart-signal-card">
          <span className="signal-badge bullish">Signal</span>
          <strong>{chartData.ticker} | {config.title}</strong>
          <p>{stockScreenerSignalCopy(config, chartData.signal)}</p>
        </div>
      ) : null}
      {loading ? <div className="empty-box">Loading screener chart...</div> : null}
      {!loading && chartData ? (
        <div className="stack">
          <OhlcvCanvas candles={chartData.candles || []} title={`${chartData.ticker} ${config.title}`} />
          <CandleTailTable candles={chartData.candles || []} />
        </div>
      ) : null}
      {!loading && !chartData && !error ? <div className="empty-box">Select a screener result to load its chart.</div> : null}
    </section>
  );
}

function StockScreenerTab() {
  const [result, setResult] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState("results");
  const [selected, setSelected] = useState(null);

  async function handleRun() {
    setError("");
    setIsRunning(true);
    try {
      const response = await runStockScreeners();
      const nextResult = response.result || null;
      setResult(nextResult);
      const firstConfig = STOCK_SCREENER_CARDS.find((config) => nextResult?.screeners?.[config.key]?.length);
      setSelected(firstConfig ? { screener: firstConfig.key, ticker: nextResult.screeners[firstConfig.key][0].ticker } : null);
      setView("results");
    } catch (screenError) {
      setResult(null);
      setSelected(null);
      setError(screenError.message);
    } finally {
      setIsRunning(false);
    }
  }

  function selectRow(screener, ticker) {
    setSelected({ screener, ticker });
    setView("chart");
  }

  const meta = result?.meta || {};
  const counts = STOCK_SCREENER_CARDS.map((config) => result?.screeners?.[config.key]?.length || 0);

  return (
    <div className="stock-screener-view">
      <section className="panel screener-run-panel">
        <div>
          <h2>Stock screener</h2>
          <p className="muted">
            Runs the earlier dashboard's stock screener logic on the UAT NSE cash universe: 52-week high/low proximity and daily/weekly volume breakouts.
          </p>
        </div>
        <button className="primary-button" type="button" onClick={handleRun} disabled={isRunning}>
          {isRunning ? "Running Screeners" : "Run UAT Stock Screeners"}
        </button>
        {isRunning ? (
          <div className="screener-status">
            <div className="progress-track"><span style={{ width: "65%" }} /></div>
            <span>Fetching daily candles and ranking screener matches...</span>
          </div>
        ) : null}
      </section>

      {error ? <div className="error-box">{error}</div> : null}

      {result ? (
        <>
          <div className="grid-view screener-summary">
            <article className="metric-card"><span>Universe</span><strong>{meta.index || "UAT NSE"}</strong></article>
            <article className="metric-card"><span>Symbols Processed</span><strong>{formatNumber(meta.processed_symbols, 0)}</strong></article>
            <article className="metric-card"><span>Matches</span><strong>{formatNumber(counts.reduce((total, count) => total + count, 0), 0)}</strong></article>
            <article className="metric-card"><span>Scan Date</span><strong>{meta.scan_date || "-"}</strong></article>
          </div>

          <section className="panel">
            <div className="compact-toolbar">
              <div className="view-toggle">
                {[
                  ["results", "Results"],
                  ["chart", "Chart"],
                  ["api", "API Response"],
                ].map(([key, label]) => (
                  <button className={view === key ? "active" : ""} key={key} type="button" onClick={() => setView(key)}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="muted">
                {meta.from_date} to {meta.to_date} | Failed {formatNumber(meta.failed_symbol_count, 0)}
              </div>
            </div>
            {view === "chart" ? <StockScreenerChartPanel result={result} selected={selected} onSelect={setSelected} /> : null}
            {view === "results" ? (
              <div className="stock-screener-grid">
                {STOCK_SCREENER_CARDS.map((config) => (
                  <section className="screener-card" key={config.key}>
                    <div className="screener-card-header">
                      <div>
                        <h2>{config.title}</h2>
                        <p className="muted">{config.description}</p>
                      </div>
                      <span className="signal-badge none">{formatNumber(result.screeners?.[config.key]?.length || 0, 0)}</span>
                    </div>
                    <ScreenerResultTable config={config} rows={result.screeners?.[config.key] || []} onSelect={selectRow} />
                  </section>
                ))}
              </div>
            ) : null}
            {view === "api" ? <JsonBlock data={result} /> : null}
          </section>
        </>
      ) : (
        <div className="empty-box">Run the UAT stock screeners to see ranked stocks, chart context, and raw API output.</div>
      )}
    </div>
  );
}

function OptimizationTab() {
  const [settings, setSettings] = useState({ ...OPTIMIZATION_BACKTEST_DEFAULTS });
  const [selectedInstrument, setSelectedInstrument] = useState({
    instrument_key: "NSE:NIFTYBEES",
    tradingsymbol: "NIFTYBEES",
    exchange: "NSE",
  });
  const [view, setView] = useState("chart");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function update(event) {
    setSettings((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  function pickInstrument(instrument) {
    if (instrument.exchange !== "NSE") {
      setError("Select an NSE cash-market instrument for this introductory backtest.");
      return;
    }
    setError("");
    setSelectedInstrument(instrument);
    setSettings((current) => ({
      ...current,
      tradingsymbol: instrument.tradingsymbol || current.tradingsymbol,
    }));
  }

  function submittedSettings() {
    return {
      tradingsymbol: String(settings.tradingsymbol || "NIFTYBEES").trim().toUpperCase(),
      from_date: settings.from_date,
      to_date: settings.to_date,
      short_sma: Number(settings.short_sma),
      long_sma: Number(settings.long_sma),
      initial_capital: Number(settings.initial_capital),
      stop_loss_pct: Number(settings.stop_loss_pct),
      take_profit_pct: Number(settings.take_profit_pct),
    };
  }

  async function runBacktest(event) {
    event.preventDefault();
    setError("");
    const payload = submittedSettings();
    if (payload.short_sma >= payload.long_sma) {
      setError("Short SMA must be lower than Long SMA.");
      return;
    }
    if (payload.initial_capital <= 0) {
      setError("Initial capital must be greater than zero.");
      return;
    }
    if (payload.stop_loss_pct <= 0 || payload.take_profit_pct <= 0) {
      setError("Stop-loss and take-profit percentages must be greater than zero.");
      return;
    }
    if (payload.from_date > payload.to_date) {
      setError("From date must be earlier than or equal to To date.");
      return;
    }
    setSettings(payload);
    setLoading(true);
    try {
      const response = await runOptimizationBacktest(payload);
      setResult(response);
      setView("chart");
    } catch (backtestError) {
      setResult(null);
      setError(backtestError.message);
    } finally {
      setLoading(false);
    }
  }

  const summary = result?.summary || {};
  const metadata = result?.metadata || {};
  const trades = result?.trades || [];
  const portfolioRows = result?.portfolio_history || [];
  const latestPortfolio = portfolioRows[portfolioRows.length - 1] || {};
  const selectedTokens = selectedInstrument?.instrument_token ? [selectedInstrument.instrument_token] : [];

  return (
    <div className="optimization-view">
      <section className="panel">
        <div>
          <h2>SMA optimization backtest</h2>
          <p className="muted">
            Uses SMA crossover entries, executes signals at the next day's open, then applies fixed stop-loss and take-profit exits while a position is open.
          </p>
        </div>
        <InstrumentPicker
          selected={selectedInstrument ? [selectedInstrument] : []}
          onPick={pickInstrument}
          placeholder="Search NSE symbol, e.g. NIFTYBEES"
        />
        <div className="form-grid optimization-grid">
          <label>
            <span>From Date</span>
            <input name="from_date" type="date" value={settings.from_date} onChange={update} required />
          </label>
          <label>
            <span>To Date</span>
            <input name="to_date" type="date" value={settings.to_date} onChange={update} required />
          </label>
          <label>
            <span>Short SMA</span>
            <input name="short_sma" min="2" max="250" type="number" value={settings.short_sma} onChange={update} required />
          </label>
          <label>
            <span>Long SMA</span>
            <input name="long_sma" min="3" max="500" type="number" value={settings.long_sma} onChange={update} required />
          </label>
          <label>
            <span>Initial Capital</span>
            <input name="initial_capital" min="1" step="1000" type="number" value={settings.initial_capital} onChange={update} required />
          </label>
          <label>
            <span>Stop-loss %</span>
            <input name="stop_loss_pct" min="0.01" max="100" step="0.01" type="number" value={settings.stop_loss_pct} onChange={update} required />
          </label>
          <label>
            <span>Take Profit %</span>
            <input name="take_profit_pct" min="0.01" max="500" step="0.01" type="number" value={settings.take_profit_pct} onChange={update} required />
          </label>
          <button className="primary-button" type="button" onClick={runBacktest} disabled={loading}>
            {loading ? "Running" : "Run Backtest"}
          </button>
        </div>
      </section>

      {error ? <div className="error-box">{error}</div> : null}

      {result ? (
        <>
          <div className="grid-view optimization-summary">
            <article className="metric-card"><span>Initial Capital</span><strong>{formatCurrency(summary.initial_capital)}</strong></article>
            <article className="metric-card"><span>Final Portfolio Value</span><strong>{formatCurrency(summary.final_portfolio_value)}</strong></article>
            <article className="metric-card"><span>Total Profit or Loss</span><strong>{formatCurrency(summary.total_profit_loss)}</strong></article>
            <article className="metric-card"><span>Total Return</span><strong>{formatNumber(summary.total_return_pct)}%</strong></article>
            <article className="metric-card"><span>Completed Trades</span><strong>{formatNumber(summary.completed_trades, 0)}</strong></article>
            <article className="metric-card"><span>Win Rate</span><strong>{formatNumber(summary.win_rate)}%</strong></article>
            <article className="metric-card"><span>Current Position</span><strong>{summary.current_position_status || "-"}</strong></article>
          </div>

          <section className="panel">
            <div className="compact-toolbar">
              <div className="view-toggle">
                {[
                  ["chart", "Strategy Chart"],
                  ["portfolio", "Portfolio"],
                  ["trades", "Trade Log"],
                  ["api", "API Response"],
                ].map(([key, label]) => (
                  <button className={view === key ? "active" : ""} key={key} type="button" onClick={() => setView(key)}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="muted">
                {metadata.tradingsymbol} | SMA {metadata.short_sma}/{metadata.long_sma} | SL {metadata.stop_loss_pct}% / TP {metadata.take_profit_pct}%
              </div>
            </div>

            {metadata.warnings?.length ? (
              <div className="info-box">
                {metadata.warnings.map((warning) => <p key={warning}>{warning}</p>)}
              </div>
            ) : null}

            {view === "chart" ? (
              <div className="stack">
                <OhlcvCanvas
                  candles={result.candles || []}
                  title={`${metadata.tradingsymbol} optimization backtest`}
                  overlays={[
                    { period: metadata.short_sma, label: `SMA ${metadata.short_sma}`, color: "#3d85c6" },
                    { period: metadata.long_sma, label: `SMA ${metadata.long_sma}`, color: "#d7923f" },
                  ]}
                />
                <OptimizationSignalTable candles={result.candles || []} />
              </div>
            ) : null}

            {view === "portfolio" ? (
              <div className="stack">
                <div className="grid-view">
                  <article className="metric-card"><span>Current Cash</span><strong>{formatCurrency(summary.current_cash ?? latestPortfolio.cash)}</strong></article>
                  <article className="metric-card"><span>Units Held</span><strong>{formatNumber(summary.units_held ?? latestPortfolio.quantity, 0)}</strong></article>
                  <article className="metric-card"><span>Position Value</span><strong>{formatCurrency(summary.current_position_value ?? latestPortfolio.position_value)}</strong></article>
                  <article className="metric-card"><span>Final Value</span><strong>{formatCurrency(summary.final_portfolio_value)}</strong></article>
                </div>
                <PortfolioHistoryTable rows={portfolioRows} />
              </div>
            ) : null}

            {view === "trades" ? <OptimizationTradesTable trades={trades} /> : null}
            {view === "api" ? <JsonBlock data={result} /> : null}
          </section>
        </>
      ) : (
        <div className="empty-box">
          Run the default NIFTYBEES optimization to see SMA entries, risk exits, trades, portfolio value, and the raw API response.
        </div>
      )}

      <section className="panel">
        <h2>How this optimization works</h2>
        <p className="muted">
          The SMA is calculated from historical closing prices. A crossover creates a signal only after the daily candle closes, so the simulated trade is executed at the next day's opening price.
        </p>
        <p className="muted">
          After entry, the daily low is checked against the stop-loss and the daily high is checked against the take-profit. If both could have happened on the same daily candle, the stop-loss is applied first as the conservative assumption.
        </p>
        <p className="muted">This is a learning tool for understanding backtest mechanics. Historical performance does not guarantee future returns.</p>
      </section>
    </div>
  );
}

function OptimizationSignalTable({ candles }) {
  const rows = (candles || []).filter((row) => row.signal || row.trade_action).slice(-20).reverse();
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Signal</th>
            <th>Trade Action</th>
            <th>Close</th>
            <th>Short SMA</th>
            <th>Long SMA</th>
            <th>Portfolio Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.date}-${index}`}>
              <td>{formatDateOnly(row.date)}</td>
              <td>{row.signal || "-"}</td>
              <td>{row.trade_action || "-"}</td>
              <td>{formatNumber(row.close)}</td>
              <td>{formatNumber(row.short_sma)}</td>
              <td>{formatNumber(row.long_sma)}</td>
              <td>{formatCurrency(row.portfolio_value)}</td>
            </tr>
          ))}
          {!rows.length ? <tr><td colSpan="7" className="empty-cell">No signals or trades yet.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function PortfolioHistoryTable({ rows }) {
  const latestRows = (rows || []).slice(-20).reverse();
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Cash</th>
            <th>Quantity</th>
            <th>Position Value</th>
            <th>Total Portfolio Value</th>
          </tr>
        </thead>
        <tbody>
          {latestRows.map((row) => (
            <tr key={row.date}>
              <td>{formatDateOnly(row.date)}</td>
              <td>{formatCurrency(row.cash)}</td>
              <td>{formatNumber(row.quantity, 0)}</td>
              <td>{formatCurrency(row.position_value)}</td>
              <td>{formatCurrency(row.total_portfolio_value)}</td>
            </tr>
          ))}
          {!latestRows.length ? <tr><td colSpan="5" className="empty-cell">No portfolio history yet.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function OptimizationTradesTable({ trades }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Trade</th>
            <th>Status</th>
            <th>Entry Date</th>
            <th>Entry Price</th>
            <th>Exit Date</th>
            <th>Exit Price</th>
            <th>Exit Reason</th>
            <th>Quantity</th>
            <th>Profit or Loss</th>
            <th>Return %</th>
          </tr>
        </thead>
        <tbody>
          {(trades || []).map((trade) => (
            <tr key={`${trade.trade_number}-${trade.entry_date}`}>
              <td>{trade.trade_number}</td>
              <td><span className={`signal-badge ${trade.status === "Open" ? "bullish" : "none"}`}>{trade.status}</span></td>
              <td>{trade.entry_date}</td>
              <td>{formatCurrency(trade.entry_price)}</td>
              <td>{trade.exit_date || "Open"}</td>
              <td>{trade.exit_price ? formatCurrency(trade.exit_price) : "Open"}</td>
              <td>{trade.exit_reason || "-"}</td>
              <td>{formatNumber(trade.quantity, 0)}</td>
              <td>{formatCurrency(trade.profit_loss)}</td>
              <td>{formatNumber(trade.return_pct)}%</td>
            </tr>
          ))}
          {!trades?.length ? <tr><td colSpan="10" className="empty-cell">No trades were generated for this date range and SMA pair.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function RealtimeTab() {
  const [selected, setSelected] = useState([]);
  const [mode, setMode] = useState("ltp");
  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const socketRef = useRef(null);

  function addInstrument(instrument) {
    setSelected((current) => {
      if (current.some((item) => item.instrument_token === instrument.instrument_token)) return current;
      return [...current, instrument];
    });
  }

  function stopStream() {
    socketRef.current?.close();
    socketRef.current = null;
    setConnected(false);
  }

  function startStream() {
    setError("");
    if (!selected.length) {
      setError("Select at least one instrument.");
      return;
    }
    stopStream();
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const tokens = selected.map((item) => item.instrument_token).join(",");
    const socket = new WebSocket(`${protocol}://${window.location.host}/api/realtime/ws?tokens=${tokens}&mode=${mode}`);
    socketRef.current = socket;
    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onerror = () => setError("WebSocket error. Check backend logs or Kite session.");
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setMessages((current) => [data, ...current].slice(0, 80));
    };
  }

  useEffect(() => () => stopStream(), []);

  return (
    <div className="stack">
      <section className="panel">
        <h2>Realtime streaming</h2>
        <InstrumentPicker selected={selected} onPick={addInstrument} />
        <div className="toolbar">
          <select value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="ltp">LTP</option>
            <option value="quote">Quote</option>
            <option value="full">Full</option>
          </select>
          <button className="primary-button" type="button" onClick={startStream} disabled={connected}>
            Start Stream
          </button>
          <button className="secondary-button" type="button" onClick={stopStream}>
            Stop
          </button>
          <button className="secondary-button" type="button" onClick={() => setSelected([])}>
            Clear Instruments
          </button>
        </div>
      </section>
      {error ? <div className="error-box">{error}</div> : null}
      <section className="terminal-panel">
        <div className="terminal-header">
          <span className={connected ? "live-dot active" : "live-dot"} />
          {connected ? "Streaming" : "Stopped"}
        </div>
        <pre>{messages.length ? JSON.stringify(messages, null, 2) : "Ticks will appear here after the stream starts."}</pre>
      </section>
    </div>
  );
}

function OrdersTab({ refreshKey = 0 }) {
  const [orderForm, setOrderForm] = useState({
    exchange: "NSE",
    tradingsymbol: "HDFCBANK",
    transaction_type: "BUY",
    quantity: 1,
    product: "MIS",
    price: "",
    tag: "uat-dashboard",
  });
  const [modifyForm, setModifyForm] = useState({ order_id: "", price: "", quantity: "" });
  const [result, setResult] = useState(null);
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function updateOrder(event) {
    setOrderForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  function updateModify(event) {
    setModifyForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function refreshOrders() {
    setError("");
    setLoading(true);
    try {
      setResult(await getOrders());
    } catch (orderError) {
      setError(orderError.message);
    } finally {
      setLoading(false);
    }
  }

  async function submitOrder(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await placeOrder({
        ...orderForm,
        tradingsymbol: orderForm.tradingsymbol.toUpperCase(),
        quantity: asNumber(orderForm.quantity),
        price: Number(orderForm.price),
        order_type: "LIMIT",
      });
      setDetails(response);
      await refreshOrders();
    } catch (orderError) {
      setError(orderError.message);
    } finally {
      setLoading(false);
    }
  }

  async function submitModify(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const payload = {
        order_id: modifyForm.order_id,
        order_type: "LIMIT",
      };
      if (modifyForm.price) payload.price = Number(modifyForm.price);
      if (modifyForm.quantity) payload.quantity = asNumber(modifyForm.quantity);
      setDetails(await modifyOrder(payload));
      await refreshOrders();
    } catch (orderError) {
      setError(orderError.message);
    } finally {
      setLoading(false);
    }
  }

  async function cancel(orderId) {
    setError("");
    setLoading(true);
    try {
      setDetails(await cancelOrder({ order_id: orderId }));
      await refreshOrders();
    } catch (orderError) {
      setError(orderError.message);
    } finally {
      setLoading(false);
    }
  }

  async function showHistory(orderId) {
    setError("");
    try {
      const [history, trades] = await Promise.all([getOrderHistory(orderId), getOrderTrades(orderId)]);
      setDetails({ history, trades });
    } catch (orderError) {
      setError(orderError.message);
    }
  }

  useEffect(() => {
    refreshOrders();
  }, []);

  useEffect(() => {
    if (refreshKey) refreshOrders();
  }, [refreshKey]);

  return (
    <div className="stack">
      <form className="panel" onSubmit={submitOrder}>
        <h2>Place UAT LIMIT order</h2>
        <div className="form-grid">
          <label>
            <span>Exchange</span>
            <select name="exchange" value={orderForm.exchange} onChange={updateOrder}>
              <option value="NSE">NSE</option>
              <option value="BSE">BSE</option>
            </select>
          </label>
          <label>
            <span>Symbol</span>
            <input name="tradingsymbol" value={orderForm.tradingsymbol} onChange={updateOrder} />
          </label>
          <label>
            <span>Side</span>
            <select name="transaction_type" value={orderForm.transaction_type} onChange={updateOrder}>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </label>
          <label>
            <span>Product</span>
            <select name="product" value={orderForm.product} onChange={updateOrder}>
              <option value="MIS">MIS</option>
              <option value="CNC">CNC</option>
              <option value="NRML">NRML</option>
            </select>
          </label>
          <label>
            <span>Quantity</span>
            <input name="quantity" min="1" type="number" value={orderForm.quantity} onChange={updateOrder} />
          </label>
          <label>
            <span>Limit Price</span>
            <input name="price" min="0" step="0.05" type="number" value={orderForm.price} onChange={updateOrder} placeholder="Use quote LTP +/- a few %" />
          </label>
          <label>
            <span>Tag</span>
            <input name="tag" value={orderForm.tag} onChange={updateOrder} />
          </label>
        </div>
        <button className="primary-button" type="submit" disabled={loading || !orderForm.price}>
          Place LIMIT Order
        </button>
        <p className="muted">Sandbox API order placement uses LIMIT orders only. Keep the price close to LTP to avoid price-band rejection.</p>
      </form>

      <form className="panel" onSubmit={submitModify}>
        <h2>Modify open order</h2>
        <div className="form-grid">
          <label>
            <span>Order ID</span>
            <input name="order_id" value={modifyForm.order_id} onChange={updateModify} />
          </label>
          <label>
            <span>New Price</span>
            <input name="price" min="0" step="0.05" type="number" value={modifyForm.price} onChange={updateModify} />
          </label>
          <label>
            <span>New Quantity</span>
            <input name="quantity" min="1" type="number" value={modifyForm.quantity} onChange={updateModify} />
          </label>
        </div>
        <button className="secondary-button" type="submit" disabled={loading || !modifyForm.order_id}>
          Modify Order
        </button>
      </form>

      {error ? <div className="error-box">{error}</div> : null}

      <section className="panel">
        <div className="toolbar compact-toolbar">
          <h2>Orders</h2>
          <button className="secondary-button" type="button" onClick={refreshOrders} disabled={loading}>
            Refresh
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Time</th>
                <th>Symbol</th>
                <th>Variety</th>
                <th>Side</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(result?.orders || []).map((row) => (
                <tr key={row.order_id}>
                  <td className="ticker-cell">{row.order_id}</td>
                  <td>{formatDateTime(row.order_timestamp || row.exchange_timestamp)}</td>
                  <td>{row.exchange}:{row.tradingsymbol}</td>
                  <td>{String(row.variety || "-").toUpperCase()}</td>
                  <td>{row.transaction_type}</td>
                  <td>{row.quantity}</td>
                  <td>{formatNumber(row.price)}</td>
                  <td>{row.status}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" onClick={() => showHistory(row.order_id)}>History</button>
                      <button type="button" onClick={() => cancel(row.order_id)}>Cancel</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!result?.orders?.length ? (
                <tr><td colSpan="9" className="empty-cell">No orders yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {details ? (
        <section className="panel">
          <h2>Order response</h2>
          <JsonBlock data={details} />
        </section>
      ) : null}
    </div>
  );
}

function PositionsPnlTab({ refreshKey = 0 }) {
  const [result, setResult] = useState(null);
  const [view, setView] = useState("clean");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [liveTicks, setLiveTicks] = useState({});
  const [streamStatus, setStreamStatus] = useState("idle");
  const [streamError, setStreamError] = useState("");
  const [lastTickAt, setLastTickAt] = useState("");
  const loadingRef = useRef(false);
  const socketRef = useRef(null);

  async function load() {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setError("");
    setLoading(true);
    try {
      setResult(await getPortfolio());
    } catch (portfolioError) {
      setError(portfolioError.message);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (refreshKey) load();
  }, [refreshKey]);

  useEffect(() => {
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const openTokens = useMemo(() => openPositionTokens(result), [result]);
  const tokenKey = openTokens.join(",");

  useEffect(() => {
    socketRef.current?.close();
    socketRef.current = null;
    setStreamError("");
    setLiveTicks((current) => {
      const allowed = new Set(openTokens.map(String));
      return Object.fromEntries(Object.entries(current).filter(([token]) => allowed.has(token)));
    });

    if (!openTokens.length) {
      setStreamStatus("idle");
      return undefined;
    }

    setStreamStatus("connecting");
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}/api/realtime/ws?tokens=${tokenKey}&mode=ltp`);
    socketRef.current = socket;
    socket.onopen = () => setStreamStatus("connecting");
    socket.onclose = () => {
      if (socketRef.current === socket) setStreamStatus("closed");
    };
    socket.onerror = () => setStreamError("Live P&L stream error. Check Kite session or backend logs.");
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "status") {
        setStreamStatus(data.status || "connected");
      }
      if (data.type === "error") {
        setStreamError(data.message || "Live P&L stream error.");
      }
      if (data.type === "ticks") {
        setLastTickAt(data.received_at || "");
        setStreamStatus("connected");
        setLiveTicks((current) => {
          const next = { ...current };
          for (const tick of data.ticks || []) {
            if (tick.instrument_token) next[String(tick.instrument_token)] = tick;
          }
          return next;
        });
      }
    };

    return () => {
      if (socketRef.current === socket) socketRef.current = null;
      socket.close();
    };
  }, [tokenKey]);

  const livePortfolio = buildLivePortfolio(result, liveTicks);
  const pnl = livePortfolio.pnl || {};

  return (
    <div className="stack">
      <section className="panel">
        <div className="toolbar compact-toolbar">
          <h2>Positions and P&L</h2>
          <div className="live-summary">
            <span className={`live-dot ${streamStatus === "connected" ? "active" : ""}`}></span>
            <span>{openTokens.length ? `Streaming ${openTokens.length} open position${openTokens.length === 1 ? "" : "s"}` : "No open positions to stream"}</span>
            {lastTickAt ? <span>Last tick {formatDateTime(lastTickAt)}</span> : null}
          </div>
          <button className="secondary-button" type="button" onClick={load} disabled={loading}>
            Refresh
          </button>
        </div>
        <div className="grid-view">
          <article className="metric-card"><span>Combined P&L</span><strong>{formatCurrency(pnl.combined_pnl)}</strong></article>
          <article className="metric-card"><span>Net Position P&L</span><strong>{formatCurrency(pnl.net_position_pnl)}</strong></article>
          <article className="metric-card"><span>Holding P&L</span><strong>{formatCurrency(pnl.holding_pnl)}</strong></article>
          <article className="metric-card"><span>Day Position P&L</span><strong>{formatCurrency(pnl.day_position_pnl)}</strong></article>
        </div>
      </section>
      {error ? <div className="error-box">{error}</div> : null}
      {streamError ? <div className="error-box">{streamError}</div> : null}
      {result?.errors?.length ? <div className="error-box">{result.errors.join(" ")}</div> : null}
      {result ? (
        <section className="panel">
          <ViewToggle value={view} onChange={setView} />
          {view === "api" ? (
            <JsonBlock data={result} />
          ) : (
            <div className="stack">
              <PositionTable title="Net Positions" rows={livePortfolio.netRows || []} />
              <PositionTable title="Day Positions" rows={livePortfolio.dayRows || []} />
              <HoldingsTable rows={livePortfolio.holdingRows || []} />
              <section className="panel nested-panel">
                <h2>Margins</h2>
                <JsonBlock data={result.margins} />
              </section>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function PositionTable({ title, rows }) {
  return (
    <section>
      <h2>{title}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Product</th>
              <th>Qty</th>
              <th>Avg Price</th>
              <th>LTP</th>
              <th>P&L</th>
              <th>Live</th>
              <th>Buy Qty</th>
              <th>Sell Qty</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((row, index) => (
              <tr key={`${title}-${row.tradingsymbol}-${index}`}>
                <td className="ticker-cell">{row.exchange}:{row.tradingsymbol}</td>
                <td>{row.product}</td>
                <td>{row.quantity}</td>
                <td>{formatNumber(row.average_price)}</td>
                <td>{formatNumber(row.live_last_price ?? row.last_price)}</td>
                <td>{formatCurrency(row.live_pnl ?? row.pnl)}</td>
                <td>{row.is_live ? <span className="signal-badge bullish">Tick</span> : "-"}</td>
                <td>{row.buy_quantity}</td>
                <td>{row.sell_quantity}</td>
              </tr>
            ))}
            {!rows?.length ? <tr><td colSpan="9" className="empty-cell">No rows.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function HoldingsTable({ rows }) {
  return (
    <section>
      <h2>Holdings</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Qty</th>
              <th>Avg Price</th>
              <th>LTP</th>
              <th>P&L</th>
              <th>Live</th>
              <th>Day Change</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((row, index) => (
              <tr key={`${row.tradingsymbol}-${index}`}>
                <td className="ticker-cell">{row.exchange}:{row.tradingsymbol}</td>
                <td>{row.quantity}</td>
                <td>{formatNumber(row.average_price)}</td>
                <td>{formatNumber(row.live_last_price ?? row.last_price)}</td>
                <td>{formatCurrency(row.live_pnl ?? row.pnl)}</td>
                <td>{row.is_live ? <span className="signal-badge bullish">Tick</span> : "-"}</td>
                <td>{formatNumber(row.day_change_percentage)}%</td>
              </tr>
            ))}
            {!rows?.length ? <tr><td colSpan="7" className="empty-cell">No holdings.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Dashboard({ onLogout }) {
  const [activeTab, setActiveTab] = useState("user");
  const [visitedTabs, setVisitedTabs] = useState(() => new Set(["user"]));
  const [tradingRefreshKey, setTradingRefreshKey] = useState(0);
  const pageTitle = TABS.find(([key]) => key === activeTab)?.[1] || "Dashboard";

  function openTab(key) {
    setVisitedTabs((current) => {
      if (current.has(key)) return current;
      return new Set([...current, key]);
    });
    setActiveTab(key);
  }

  function markTradingDataChanged() {
    setTradingRefreshKey((current) => current + 1);
  }

  function renderTabPanel(key, component) {
    if (!visitedTabs.has(key)) return null;
    return (
      <section hidden={activeTab !== key}>
        {component}
      </section>
    );
  }

  async function handleLogout() {
    await logout();
    onLogout();
  }

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">Varsity Kite</div>
        <nav>
          {NAV_SECTIONS.map((section, sectionIndex) => (
            <div
              className={`nav-section ${section.title ? `nav-section-${section.title.toLowerCase()}` : "nav-section-plain"}`}
              key={section.title || `section-${sectionIndex}`}
            >
              {section.title ? <div className="nav-section-title">{section.title}</div> : null}
              {section.tabs.map(([key, label]) => (
                <button
                  className={activeTab === key ? "tab-button active" : "tab-button"}
                  key={key}
                  type="button"
                  onClick={() => openTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <section className="dashboard-main">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h1>{pageTitle}</h1>
          </div>
          <button className="secondary-button" type="button" onClick={handleLogout}>Logout</button>
        </header>
        <div className="content-panel">
          {renderTabPanel("user", <UserTab />)}
          {renderTabPanel("instruments", <InstrumentsTab />)}
          {renderTabPanel("snapshot", <SnapshotTab />)}
          {renderTabPanel("historical", <HistoricalTab />)}
          {renderTabPanel("stockScreener", <StockScreenerTab />)}
          {renderTabPanel("optimization", <OptimizationTab />)}
          {renderTabPanel("realtime", <RealtimeTab />)}
          {renderTabPanel("orders", <OrdersTab refreshKey={tradingRefreshKey} />)}
          {renderTabPanel("portfolio", <PositionsPnlTab refreshKey={tradingRefreshKey} />)}
        </div>
      </section>
    </main>
  );
}

function App() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [session, setSession] = useState(null);

  useEffect(() => {
    getSession()
      .then((nextSession) => {
        setSession(nextSession);
        setAuthenticated(Boolean(nextSession.authenticated));
      })
      .catch(() => {
        setSession(null);
        setAuthenticated(false);
      })
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <div className="boot-screen">Checking Kite session...</div>;
  if (!authenticated) return <LoginPage session={session} onLoggedIn={() => setAuthenticated(true)} />;
  return <Dashboard onLogout={() => setAuthenticated(false)} />;
}

createRoot(document.getElementById("root")).render(<App />);
