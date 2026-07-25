from __future__ import annotations

import asyncio
import csv
import io
import json
import math
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from kiteconnect import KiteConnect, KiteTicker
from pydantic import BaseModel, Field


APP_DIR = Path(__file__).resolve().parent
SESSION_FILE = APP_DIR / ".kite_uat_session.json"
CACHE_DIR = APP_DIR / ".cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

SANDBOX_API_KEY = "sandboxdemo"
SANDBOX_API_SECRET = "sandboxdemo-secret"
SANDBOX_ROOT = "https://sandbox.kite.trade"
SANDBOX_LOGIN_URL = f"{SANDBOX_ROOT}/connect/login?api_key={SANDBOX_API_KEY}"
SANDBOX_WS_ROOT = "wss://ws-sandbox.kite.trade"
OMS_ROUTE_PASSTHROUGH = {"market.instruments.all", "market.instruments"}
INSTRUMENT_CACHE_SECONDS = 15 * 60
HISTORICAL_INTERVALS = {
    "minute",
    "3minute",
    "5minute",
    "10minute",
    "15minute",
    "30minute",
    "60minute",
    "day",
}
SNAPSHOT_MODES = {"ltp", "ohlc", "quote"}
UAT_SYMBOL_PRIORITY = {
    "RELIANCE": 0,
    "HDFCBANK": 1,
    "INFY": 2,
    "TCS": 3,
    "ICICIBANK": 4,
    "SBIN": 5,
}
UAT_STOCK_SCREENER_SYMBOLS = [
    "ADANIENT",
    "ADANIPORTS",
    "APOLLOHOSP",
    "ASIANPAINT",
    "AXISBANK",
    "BAJAJ-AUTO",
    "BAJFINANCE",
    "BAJAJFINSV",
    "BEL",
    "BHARTIARTL",
    "CIPLA",
    "COALINDIA",
    "DRREDDY",
    "EICHERMOT",
    "ETERNAL",
    "GRASIM",
    "HCLTECH",
    "HDFCBANK",
    "HDFCLIFE",
    "HINDALCO",
    "HINDUNILVR",
    "ICICIBANK",
    "INDIGO",
    "INFY",
    "ITC",
    "JIOFIN",
    "JSWSTEEL",
    "KOTAKBANK",
    "LT",
    "M&M",
    "MARUTI",
    "NESTLEIND",
    "NTPC",
    "ONGC",
    "POWERGRID",
    "RELIANCE",
    "SBILIFE",
    "SHRIRAMFIN",
    "SBIN",
    "SUNPHARMA",
    "TATACONSUM",
    "TATASTEEL",
    "TCS",
    "TECHM",
    "TITAN",
    "TRENT",
    "ULTRACEMCO",
    "WIPRO",
]
STOCK_SCREENER_KEYS = {
    "near_52_week_high",
    "daily_volume_breakout",
    "weekly_volume_breakout",
    "near_52_week_low",
}
SCREENER_LOOKBACK_DAYS = 365 * 2
SCREENER_MAX_SYMBOLS = 60
app = FastAPI(title="Varsity Kite UAT Dashboard")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

instrument_cache: dict[str, Any] = {"key": "", "loaded_at": None, "rows": []}


class LoginRequest(BaseModel):
    api_key: str = Field(default=SANDBOX_API_KEY, min_length=1)
    api_secret: str = Field(default=SANDBOX_API_SECRET)
    request_token: str = ""
    access_token: str = ""
    user_id: str = ""


class SnapshotRequest(BaseModel):
    mode: str = "ltp"
    instruments: list[str] = Field(min_length=1, max_length=250)


class HistoricalRequest(BaseModel):
    instrument_token: int
    tradingsymbol: str
    exchange: str = "NSE"
    interval: str = "day"
    from_date: date
    to_date: date
    continuous: bool = False
    oi: bool = False


class OptimizationBacktestRequest(BaseModel):
    tradingsymbol: str = Field(default="NIFTYBEES", min_length=1)
    from_date: date = Field(default_factory=lambda: date.today() - timedelta(days=365 * 5))
    to_date: date = Field(default_factory=date.today)
    short_sma: int = Field(default=10, ge=2, le=250)
    long_sma: int = Field(default=30, ge=3, le=500)
    initial_capital: float = Field(default=500_000, gt=0)
    stop_loss_pct: float = Field(default=1, gt=0, le=100)
    take_profit_pct: float = Field(default=5, gt=0, le=500)


class PlaceOrderRequest(BaseModel):
    variety: str = "regular"
    exchange: str = "NSE"
    tradingsymbol: str = Field(min_length=1)
    transaction_type: str = Field(default="BUY")
    quantity: int = Field(default=1, ge=1)
    product: str = Field(default="MIS")
    order_type: str = Field(default="LIMIT")
    price: float = Field(gt=0)
    tag: str | None = "uat-dashboard"


class ModifyOrderRequest(BaseModel):
    variety: str = "regular"
    order_id: str = Field(min_length=1)
    quantity: int | None = Field(default=None, ge=1)
    price: float | None = Field(default=None, gt=0)
    trigger_price: float | None = Field(default=None, ge=0)
    order_type: str | None = "LIMIT"


class CancelOrderRequest(BaseModel):
    variety: str = "regular"
    order_id: str = Field(min_length=1)


def json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [json_safe(item) for item in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value


def patch_sandbox_routes(kite: KiteConnect) -> KiteConnect:
    kite._routes = {
        key: value
        if key in OMS_ROUTE_PASSTHROUGH or str(value).startswith("/oms")
        else "/oms" + value
        for key, value in kite._routes.items()
    }
    return kite


def make_kite(api_key: str = SANDBOX_API_KEY, access_token: str | None = None) -> KiteConnect:
    kite = KiteConnect(api_key=api_key, root=SANDBOX_ROOT)
    patch_sandbox_routes(kite)
    if access_token:
        kite.set_access_token(access_token)
    return kite


def save_session(api_key: str, access_token: str, user_id: str | None = None) -> None:
    SESSION_FILE.write_text(
        json.dumps(
            {"api_key": api_key, "access_token": access_token, "user_id": user_id or ""},
            indent=2,
        ),
        encoding="utf-8",
    )


def load_session() -> dict[str, str] | None:
    if not SESSION_FILE.exists():
        return None
    try:
        data = json.loads(SESSION_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    if not data.get("api_key") or not data.get("access_token"):
        return None
    return {
        "api_key": str(data["api_key"]),
        "access_token": str(data["access_token"]),
        "user_id": str(data.get("user_id") or ""),
    }


def get_kite() -> KiteConnect:
    session = load_session()
    if not session:
        raise HTTPException(status_code=401, detail="No saved UAT Kite session found.")
    return make_kite(session["api_key"], session["access_token"])


def normalize_instrument(row: dict[str, Any]) -> dict[str, Any]:
    exchange = str(row.get("exchange") or "")
    symbol = str(row.get("tradingsymbol") or "")
    name = str(row.get("name") or "")
    return {
        "instrument_token": row.get("instrument_token"),
        "tradingsymbol": symbol,
        "name": name,
        "exchange": exchange,
        "instrument_type": row.get("instrument_type") or "",
        "segment": row.get("segment") or "",
        "expiry": row.get("expiry"),
        "strike": row.get("strike"),
        "tick_size": row.get("tick_size"),
        "lot_size": row.get("lot_size"),
        "instrument_key": f"{exchange}:{symbol}",
        "label": f"{exchange}:{symbol}" + (f" - {name}" if name else ""),
    }


def get_cached_instruments(kite: KiteConnect, exchange: str | None = None) -> list[dict[str, Any]]:
    cache_key = exchange or "ALL"
    loaded_at = instrument_cache.get("loaded_at")
    if (
        loaded_at
        and instrument_cache.get("key") == cache_key
        and (datetime.now() - loaded_at).total_seconds() < INSTRUMENT_CACHE_SECONDS
    ):
        return instrument_cache["rows"]
    try:
        raw_rows = kite.instruments(exchange=exchange) if exchange else kite.instruments()
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Could not fetch UAT instruments: {error}") from error
    rows = [normalize_instrument(row) for row in raw_rows]
    instrument_cache.update({"key": cache_key, "loaded_at": datetime.now(), "rows": rows})
    return rows


def normalize_query_symbol(query: str, exchange: str) -> tuple[str, str]:
    value = query.strip().upper()
    if ":" in value:
        query_exchange, symbol = value.split(":", 1)
        return query_exchange.strip() or exchange, symbol.strip()
    return exchange, value


def quote_instrument(kite: KiteConnect, exchange: str, symbol: str) -> dict[str, Any] | None:
    if not symbol or not symbol.replace("-", "").replace("&", "").isalnum():
        return None
    instrument_key = f"{exchange}:{symbol}"
    try:
        data = kite.quote([instrument_key]).get(instrument_key)
    except Exception:
        return None
    if not data or not data.get("instrument_token"):
        return None
    return {
        "instrument_token": data.get("instrument_token"),
        "tradingsymbol": symbol,
        "name": data.get("tradingsymbol") or symbol,
        "exchange": exchange,
        "instrument_type": "EQ" if exchange in {"NSE", "BSE"} else "",
        "segment": exchange,
        "expiry": None,
        "strike": None,
        "tick_size": None,
        "lot_size": None,
        "instrument_key": instrument_key,
        "label": instrument_key,
    }


def search_instrument_rows(
    kite: KiteConnect,
    exchange: str = "NSE",
    instrument_type: str = "",
    query: str = "",
    limit: int = 100,
    include_quote_fallback: bool = False,
) -> dict[str, Any]:
    exchange_value = exchange.strip().upper() or None
    type_value = instrument_type.strip().upper()
    query_value = query.strip()
    needle = query_value.lower()
    rows = []
    for row in get_cached_instruments(kite, exchange=exchange_value):
        if type_value and str(row.get("instrument_type") or "").upper() != type_value:
            continue
        haystack = f"{row['tradingsymbol']} {row['name']} {row['instrument_key']} {row['instrument_type']}".lower()
        if needle and needle not in haystack:
            continue
        rows.append(row)

    symbol_exchange, symbol = normalize_query_symbol(query_value, exchange_value or "NSE")
    if include_quote_fallback and symbol:
        exact_key = f"{symbol_exchange}:{symbol}"
        has_exact = any(row.get("instrument_key") == exact_key for row in rows)
        if not has_exact:
            fallback = quote_instrument(kite, symbol_exchange, symbol)
            if fallback and (not type_value or fallback["instrument_type"] == type_value):
                rows.insert(0, fallback)

    query_upper = symbol or query_value.upper()
    rows.sort(
        key=lambda item: (
            item["tradingsymbol"] != query_upper,
            not item["tradingsymbol"].startswith(query_upper),
            UAT_SYMBOL_PRIORITY.get(item["tradingsymbol"], 999),
            "-" in item["tradingsymbol"],
            item["tradingsymbol"],
        )
    )
    return {
        "instruments": rows[:limit],
        "meta": {
            "exchange": exchange_value or "ALL",
            "matched": len(rows),
            "returned": min(len(rows), limit),
            "loaded_at": instrument_cache.get("loaded_at").isoformat() if instrument_cache.get("loaded_at") else "",
        },
    }


def clean_candles(candles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for candle in candles:
        row = json_safe(candle)
        if "date" in row:
            row["date"] = str(row["date"])
        rows.append(row)
    return rows


def historical_data_chunked(
    kite: KiteConnect,
    instrument_token: int,
    from_date: date,
    to_date: date,
    interval: str,
    continuous: bool,
    oi: bool,
) -> list[dict[str, Any]]:
    max_days = 1900 if interval == "day" else 60
    start = from_date
    candles: list[dict[str, Any]] = []
    while start <= to_date:
        chunk_end = min(start + timedelta(days=max_days), to_date)
        candles.extend(
            kite.historical_data(
                instrument_token,
                start,
                chunk_end,
                interval,
                continuous=continuous,
                oi=oi,
            )
        )
        start = chunk_end + timedelta(days=1)
    return clean_candles(candles)


def row_float(row: dict[str, Any], key: str) -> float:
    try:
        return float(row.get(key) or 0)
    except (TypeError, ValueError):
        return 0.0


def safe_round(value: Any, digits: int = 2) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return round(number, digits)


def int_or_none(value: Any) -> int | None:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def parse_candle_date(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())
    text = str(value or "").replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return datetime.strptime(text[:10], "%Y-%m-%d")


def valid_daily_candles(candles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for candle in candles:
        try:
            open_price = float(candle.get("open"))
            high_price = float(candle.get("high"))
            low_price = float(candle.get("low"))
            close_price = float(candle.get("close"))
        except (TypeError, ValueError):
            continue
        if min(open_price, high_price, low_price, close_price) <= 0:
            continue
        rows.append(
            {
                "date": parse_candle_date(candle.get("date")),
                "open": open_price,
                "high": high_price,
                "low": low_price,
                "close": close_price,
                "volume": int_or_none(candle.get("volume")),
            }
        )
    rows.sort(key=lambda row: row["date"])
    return rows


def add_sma_values(rows: list[dict[str, Any]], short_sma: int, long_sma: int) -> list[dict[str, Any]]:
    short_sum = 0.0
    long_sum = 0.0
    for index, row in enumerate(rows):
        close_price = float(row["close"])
        short_sum += close_price
        long_sum += close_price
        if index >= short_sma:
            short_sum -= float(rows[index - short_sma]["close"])
        if index >= long_sma:
            long_sum -= float(rows[index - long_sma]["close"])
        row["short_sma"] = short_sum / short_sma if index >= short_sma - 1 else None
        row["long_sma"] = long_sum / long_sma if index >= long_sma - 1 else None
        row["previous_short_sma"] = rows[index - 1].get("short_sma") if index > 0 else None
        row["previous_long_sma"] = rows[index - 1].get("long_sma") if index > 0 else None
    return rows


def find_nse_instrument(kite: KiteConnect, tradingsymbol: str) -> dict[str, Any] | None:
    symbol = tradingsymbol.strip().upper()
    for row in get_cached_instruments(kite, exchange="NSE"):
        if row.get("tradingsymbol") == symbol and row.get("instrument_token"):
            return row
    return quote_instrument(kite, "NSE", symbol)


def latest_price_change_pct(rows: list[dict[str, Any]]) -> float | None:
    if len(rows) < 2:
        return None
    previous_close = float(rows[-2]["close"])
    if previous_close == 0:
        return None
    return ((float(rows[-1]["close"]) - previous_close) / previous_close) * 100


def safe_ratio(numerator: Any, denominator: Any) -> float | None:
    try:
        top = float(numerator)
        bottom = float(denominator)
    except (TypeError, ValueError):
        return None
    if bottom <= 0 or math.isnan(top) or math.isnan(bottom) or math.isinf(top) or math.isinf(bottom):
        return None
    return top / bottom


def average_volume(rows: list[dict[str, Any]]) -> float | None:
    volumes = [float(row["volume"]) for row in rows if row.get("volume") is not None]
    if len(volumes) != len(rows) or not volumes:
        return None
    return sum(volumes) / len(volumes)


def build_near_52_week_high_row(
    symbol: str,
    company: str,
    rows: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if len(rows) < 253:
        return None

    current = rows[-1]
    previous = rows[:-1]
    lookback = previous[-252:]

    if len(lookback) < 252:
        return None

    high_row = max(lookback, key=lambda row: float(row["high"]))
    high_value = float(high_row["high"])
    current_close = float(current["close"])

    if high_value <= 0:
        return None

    recent_dates = {row["date"].date() for row in previous[-22:]}
    if high_row["date"].date() in recent_dates:
        return None

    distance_pct = ((high_value - current_close) / high_value) * 100
    if distance_pct < 0 or distance_pct > 5:
        return None

    return {
        "ticker": symbol,
        "company": company,
        "current_price": safe_round(current_close),
        "reference_value": safe_round(high_value),
        "metric_value": safe_round(distance_pct),
        "price_change_pct": safe_round(latest_price_change_pct(rows)),
        "relevant_date": high_row["date"].date().isoformat(),
    }


def build_near_52_week_low_row(
    symbol: str,
    company: str,
    rows: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if len(rows) < 253:
        return None

    current = rows[-1]
    previous = rows[:-1]
    lookback = previous[-252:]

    if len(lookback) < 252:
        return None

    low_row = min(lookback, key=lambda row: float(row["low"]))
    low_value = float(low_row["low"])
    current_close = float(current["close"])

    if low_value <= 0:
        return None

    recent_dates = {row["date"].date() for row in previous[-22:]}
    if low_row["date"].date() in recent_dates:
        return None

    distance_pct = ((current_close - low_value) / low_value) * 100
    if distance_pct < 0 or distance_pct > 5:
        return None

    return {
        "ticker": symbol,
        "company": company,
        "current_price": safe_round(current_close),
        "reference_value": safe_round(low_value),
        "metric_value": safe_round(distance_pct),
        "price_change_pct": safe_round(latest_price_change_pct(rows)),
        "relevant_date": low_row["date"].date().isoformat(),
    }


def build_daily_volume_breakout_row(
    symbol: str,
    company: str,
    rows: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if len(rows) < 23:
        return None

    current = rows[-1]
    previous_22 = rows[:-1][-22:]

    if len(previous_22) < 22:
        return None

    avg_volume = average_volume(previous_22)
    volume_ratio = safe_ratio(current.get("volume"), avg_volume)

    if volume_ratio is None:
        return None

    return {
        "ticker": symbol,
        "company": company,
        "current_price": safe_round(current["close"]),
        "reference_value": int(current["volume"]),
        "comparison_value": int(round(float(avg_volume))),
        "metric_value": safe_round(volume_ratio),
        "price_change_pct": safe_round(latest_price_change_pct(rows)),
        "relevant_date": current["date"].date().isoformat(),
    }


def week_end_friday(value: date) -> date:
    return value + timedelta(days=(4 - value.weekday()) % 7)


def build_weekly_volume_breakout_row(
    symbol: str,
    company: str,
    rows: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if len(rows) < 260:
        return None

    weekly_rows: dict[date, dict[str, Any]] = {}
    for row in rows:
        row_date = row["date"].date()
        week_end = week_end_friday(row_date)
        current_week = weekly_rows.setdefault(
            week_end,
            {
                "week_start": row_date,
                "week_end": week_end,
                "close": row["close"],
                "volume": 0,
            },
        )
        current_week["week_start"] = min(current_week["week_start"], row_date)
        current_week["close"] = row["close"]
        current_week["volume"] += int(row.get("volume") or 0)

    weeks = list(weekly_rows.values())
    if len(weeks) < 53:
        return None

    current_week = weeks[-1]
    completed_weeks = weeks[:-1][-52:]
    if len(completed_weeks) < 52:
        return None

    avg_volume = sum(float(row["volume"]) for row in completed_weeks) / len(completed_weeks)
    volume_ratio = safe_ratio(current_week.get("volume"), avg_volume)

    if volume_ratio is None:
        return None

    latest_date = rows[-1]["date"].date()
    week_end_date = current_week["week_end"]
    now = datetime.now()
    current_calendar_week_end = week_end_friday(now.date())
    market_week_has_ended = now.weekday() > 4 or (now.weekday() == 4 and (now.hour, now.minute) >= (15, 30))
    current_week_incomplete = latest_date < week_end_date or (
        week_end_date == current_calendar_week_end and not market_week_has_ended
    )

    return {
        "ticker": symbol,
        "company": company,
        "current_price": safe_round(rows[-1]["close"]),
        "reference_value": int(current_week["volume"]),
        "comparison_value": int(round(float(avg_volume))),
        "metric_value": safe_round(volume_ratio),
        "price_change_pct": safe_round(latest_price_change_pct(rows)),
        "relevant_date": week_end_date.isoformat(),
        "current_week_incomplete": bool(current_week_incomplete),
    }


def add_rank(rows: list[dict[str, Any]], sort_key: str, reverse: bool) -> list[dict[str, Any]]:
    ranked = sorted(rows, key=lambda item: item[sort_key], reverse=reverse)[:10]
    for index, row in enumerate(ranked, start=1):
        row["rank"] = index
    return ranked


def calculate_stock_screeners(
    symbol: str,
    company: str,
    candles: list[dict[str, Any]],
) -> dict[str, dict[str, Any] | None]:
    rows = valid_daily_candles(candles)
    if not rows:
        return {
            "near_52_week_high": None,
            "daily_volume_breakout": None,
            "weekly_volume_breakout": None,
            "near_52_week_low": None,
        }
    return {
        "near_52_week_high": build_near_52_week_high_row(symbol, company, rows),
        "daily_volume_breakout": build_daily_volume_breakout_row(symbol, company, rows),
        "weekly_volume_breakout": build_weekly_volume_breakout_row(symbol, company, rows),
        "near_52_week_low": build_near_52_week_low_row(symbol, company, rows),
    }


def serialize_stock_chart_candles(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "date": row["date"].date().isoformat(),
            "open": safe_round(row["open"]),
            "high": safe_round(row["high"]),
            "low": safe_round(row["low"]),
            "close": safe_round(row["close"]),
            "volume": int_or_none(row.get("volume")),
        }
        for row in rows
    ]


def stock_screener_universe(kite: KiteConnect, limit: int = SCREENER_MAX_SYMBOLS) -> list[dict[str, Any]]:
    instrument_rows = get_cached_instruments(kite, exchange="NSE")
    by_symbol = {
        str(row.get("tradingsymbol") or "").upper(): row
        for row in instrument_rows
        if row.get("instrument_token") and str(row.get("instrument_type") or "").upper() in {"EQ", ""}
    }
    mapped_symbols: list[dict[str, Any]] = []
    seen = set()

    for symbol in UAT_STOCK_SCREENER_SYMBOLS:
        row = by_symbol.get(symbol) or quote_instrument(kite, "NSE", symbol)
        if not row or not row.get("instrument_token") or symbol in seen:
            continue
        seen.add(symbol)
        mapped_symbols.append(
            {
                "symbol": symbol,
                "company": str(row.get("name") or symbol).strip() or symbol,
                "instrument_token": int(row["instrument_token"]),
            }
        )

    if mapped_symbols:
        return mapped_symbols[:limit]

    candidates = [
        row
        for row in instrument_rows
        if row.get("instrument_token") and str(row.get("instrument_type") or "").upper() == "EQ"
    ]
    candidates.sort(
        key=lambda item: (
            UAT_SYMBOL_PRIORITY.get(item["tradingsymbol"], 999),
            "-" in item["tradingsymbol"],
            item["tradingsymbol"],
        )
    )
    return [
        {
            "symbol": str(row["tradingsymbol"]),
            "company": str(row.get("name") or row["tradingsymbol"]).strip() or str(row["tradingsymbol"]),
            "instrument_token": int(row["instrument_token"]),
        }
        for row in candidates[:limit]
    ]


def build_stock_screener_result(limit: int = SCREENER_MAX_SYMBOLS) -> dict[str, Any]:
    started_at = datetime.now()
    kite = get_kite()
    to_date = date.today()
    from_date = to_date - timedelta(days=SCREENER_LOOKBACK_DAYS)
    universe = stock_screener_universe(kite, limit)

    if not universe:
        raise HTTPException(status_code=404, detail="Could not map any UAT NSE symbols for stock screening.")

    near_high_rows: list[dict[str, Any]] = []
    daily_volume_rows: list[dict[str, Any]] = []
    weekly_volume_rows: list[dict[str, Any]] = []
    near_low_rows: list[dict[str, Any]] = []
    failed_symbols: list[dict[str, str]] = []
    insufficient_history = 0

    for stock in universe:
        try:
            candles = historical_data_chunked(
                kite,
                stock["instrument_token"],
                from_date,
                to_date,
                "day",
                False,
                False,
            )
            screeners = calculate_stock_screeners(stock["symbol"], stock["company"], candles)
            if screeners["near_52_week_high"]:
                near_high_rows.append(screeners["near_52_week_high"])
            if screeners["daily_volume_breakout"]:
                daily_volume_rows.append(screeners["daily_volume_breakout"])
            if screeners["weekly_volume_breakout"]:
                weekly_volume_rows.append(screeners["weekly_volume_breakout"])
            if screeners["near_52_week_low"]:
                near_low_rows.append(screeners["near_52_week_low"])
            if not any(screeners.values()):
                insufficient_history += 1
        except Exception as error:
            failed_symbols.append({"ticker": stock["symbol"], "error": str(error)})

    return json_safe(
        {
            "screeners": {
                "near_52_week_high": add_rank(near_high_rows, "metric_value", reverse=False),
                "daily_volume_breakout": add_rank(daily_volume_rows, "metric_value", reverse=True),
                "weekly_volume_breakout": add_rank(weekly_volume_rows, "metric_value", reverse=True),
                "near_52_week_low": add_rank(near_low_rows, "metric_value", reverse=False),
            },
            "meta": {
                "index": "UAT NSE cash universe",
                "scan_date": to_date.isoformat(),
                "from_date": from_date.isoformat(),
                "to_date": to_date.isoformat(),
                "mapped_symbols": len(universe),
                "processed_symbols": len(universe),
                "failed_symbols": failed_symbols[:50],
                "failed_symbol_count": len(failed_symbols),
                "insufficient_history_count": insufficient_history,
                "last_updated": datetime.now().isoformat(),
                "cache": "miss",
                "duration_seconds": round((datetime.now() - started_at).total_seconds(), 1),
            },
        }
    )


def build_optimization_backtest(payload: OptimizationBacktestRequest) -> dict[str, Any]:
    if payload.short_sma >= payload.long_sma:
        raise HTTPException(status_code=400, detail="Short SMA must be lower than Long SMA.")
    if payload.from_date > payload.to_date:
        raise HTTPException(status_code=400, detail="From date must be earlier than or equal to To date.")

    symbol = payload.tradingsymbol.strip().upper()
    kite = get_kite()
    instrument = find_nse_instrument(kite, symbol)
    if not instrument or not instrument.get("instrument_token"):
        raise HTTPException(status_code=404, detail=f"Could not find {symbol} in NSE instruments.")

    instrument_token = int(instrument["instrument_token"])
    try:
        raw_candles = historical_data_chunked(
            kite,
            instrument_token,
            payload.from_date,
            payload.to_date,
            "day",
            False,
            False,
        )
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Could not fetch UAT historical candles for {symbol}: {error}") from error

    price_data = add_sma_values(valid_daily_candles(raw_candles), payload.short_sma, payload.long_sma)
    if len(price_data) < payload.long_sma + 1:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Need at least {payload.long_sma + 1} daily candles to calculate SMA "
                f"{payload.long_sma} and detect a crossover. Only {len(price_data)} valid candles are available."
            ),
        )

    cash = float(payload.initial_capital)
    quantity = 0
    current_trade: dict[str, Any] | None = None
    pending_action: str | None = None
    pending_signal_date: str | None = None
    trades: list[dict[str, Any]] = []
    candle_rows: list[dict[str, Any]] = []
    portfolio_history: list[dict[str, Any]] = []
    warnings: list[str] = []

    for index, candle in enumerate(price_data):
        candle_date = candle["date"].date().isoformat()
        open_price = float(candle["open"])
        high_price = float(candle["high"])
        low_price = float(candle["low"])
        close_price = float(candle["close"])
        trade_action: str | None = None

        if pending_action == "Buy" and quantity == 0:
            units_to_buy = int(cash // open_price)
            if units_to_buy > 0:
                cost = units_to_buy * open_price
                cash -= cost
                quantity = units_to_buy
                current_trade = {
                    "trade_number": len(trades) + 1,
                    "buy_signal_date": pending_signal_date,
                    "entry_date": candle_date,
                    "entry_price": safe_round(open_price),
                    "quantity": quantity,
                    "entry_value": safe_round(cost),
                    "status": "Open",
                }
                trade_action = "Buy"
            else:
                warnings.append(f"Buy signal from {pending_signal_date} was skipped because cash was insufficient.")
        elif pending_action == "Sell" and quantity > 0 and current_trade:
            exit_value = quantity * open_price
            entry_value = float(current_trade["entry_price"]) * quantity
            profit_loss = exit_value - entry_value
            cash += exit_value
            trade_action = "Sell"
            trades.append(
                {
                    **current_trade,
                    "sell_signal_date": pending_signal_date,
                    "exit_date": candle_date,
                    "exit_price": safe_round(open_price),
                    "exit_value": safe_round(exit_value),
                    "profit_loss": safe_round(profit_loss),
                    "return_pct": safe_round((profit_loss / entry_value) * 100 if entry_value else 0),
                    "exit_reason": "SMA Cross Down",
                    "status": "Closed",
                }
            )
            quantity = 0
            current_trade = None

        pending_action = None
        pending_signal_date = None

        if quantity > 0 and current_trade:
            entry_price = float(current_trade["entry_price"])
            stop_price = entry_price * (1 - (float(payload.stop_loss_pct) / 100))
            target_price = entry_price * (1 + (float(payload.take_profit_pct) / 100))
            exit_price: float | None = None
            exit_reason: str | None = None
            if low_price <= stop_price:
                exit_price = stop_price
                exit_reason = "Stop Loss"
            elif high_price >= target_price:
                exit_price = target_price
                exit_reason = "Take Profit"
            if exit_price is not None and exit_reason:
                exit_value = quantity * exit_price
                entry_value = entry_price * quantity
                profit_loss = exit_value - entry_value
                cash += exit_value
                trade_action = exit_reason
                trades.append(
                    {
                        **current_trade,
                        "sell_signal_date": None,
                        "exit_date": candle_date,
                        "exit_price": safe_round(exit_price),
                        "exit_value": safe_round(exit_value),
                        "profit_loss": safe_round(profit_loss),
                        "return_pct": safe_round((profit_loss / entry_value) * 100 if entry_value else 0),
                        "exit_reason": exit_reason,
                        "status": "Closed",
                    }
                )
                quantity = 0
                current_trade = None

        signal: str | None = None
        has_sma_pair = all(
            value is not None
            for value in (
                candle.get("previous_short_sma"),
                candle.get("previous_long_sma"),
                candle.get("short_sma"),
                candle.get("long_sma"),
            )
        )
        if has_sma_pair:
            bullish = candle["previous_short_sma"] <= candle["previous_long_sma"] and candle["short_sma"] > candle["long_sma"]
            bearish = candle["previous_short_sma"] >= candle["previous_long_sma"] and candle["short_sma"] < candle["long_sma"]
            if bullish and quantity == 0:
                signal = "Buy"
                if index < len(price_data) - 1:
                    pending_action = "Buy"
                    pending_signal_date = candle_date
                else:
                    warnings.append(f"Buy signal on {candle_date} was not executed because no next candle exists.")
            elif bearish and quantity > 0:
                signal = "Sell"
                if index < len(price_data) - 1:
                    pending_action = "Sell"
                    pending_signal_date = candle_date
                else:
                    warnings.append(f"Sell signal on {candle_date} was not executed because no next candle exists.")

        position_value = quantity * close_price
        portfolio_value = cash + position_value
        candle_rows.append(
            {
                "date": candle_date,
                "open": safe_round(candle["open"]),
                "high": safe_round(candle["high"]),
                "low": safe_round(candle["low"]),
                "close": safe_round(candle["close"]),
                "volume": candle.get("volume"),
                "short_sma": safe_round(candle.get("short_sma")),
                "long_sma": safe_round(candle.get("long_sma")),
                "signal": signal,
                "trade_action": trade_action,
                "portfolio_value": safe_round(portfolio_value),
            }
        )
        portfolio_history.append(
            {
                "date": candle_date,
                "cash": safe_round(cash),
                "quantity": quantity,
                "position_value": safe_round(position_value),
                "total_portfolio_value": safe_round(portfolio_value),
            }
        )

    final_close = float(price_data[-1]["close"])
    final_position_value = quantity * final_close
    final_portfolio_value = cash + final_position_value
    if current_trade:
        entry_value = float(current_trade["entry_price"]) * quantity
        open_profit_loss = final_position_value - entry_value
        trades.append(
            {
                **current_trade,
                "sell_signal_date": None,
                "exit_date": None,
                "exit_price": None,
                "exit_value": None,
                "current_price": safe_round(final_close),
                "current_value": safe_round(final_position_value),
                "profit_loss": safe_round(open_profit_loss),
                "return_pct": safe_round((open_profit_loss / entry_value) * 100 if entry_value else 0),
                "exit_reason": None,
                "status": "Open",
            }
        )

    closed_trades = [trade for trade in trades if trade.get("status") == "Closed"]
    winning_trades = [trade for trade in closed_trades if float(trade.get("profit_loss") or 0) > 0]
    losing_trades = [trade for trade in closed_trades if float(trade.get("profit_loss") or 0) < 0]
    total_profit_loss = final_portfolio_value - float(payload.initial_capital)
    total_return_pct = (total_profit_loss / float(payload.initial_capital)) * 100

    return json_safe(
        {
            "candles": candle_rows,
            "trades": trades,
            "portfolio_history": portfolio_history,
            "summary": {
                "initial_capital": safe_round(payload.initial_capital),
                "final_portfolio_value": safe_round(final_portfolio_value),
                "total_profit_loss": safe_round(total_profit_loss),
                "total_return_pct": safe_round(total_return_pct),
                "completed_trades": len(closed_trades),
                "winning_trades": len(winning_trades),
                "losing_trades": len(losing_trades),
                "win_rate": safe_round((len(winning_trades) / len(closed_trades)) * 100 if closed_trades else 0),
                "current_position_status": "Open" if quantity > 0 else "Flat",
                "current_cash": safe_round(cash),
                "units_held": quantity,
                "current_position_value": safe_round(final_position_value),
            },
            "metadata": {
                "tradingsymbol": symbol,
                "exchange": "NSE",
                "instrument_token": instrument_token,
                "instrument_name": instrument.get("name") or symbol,
                "from_date": payload.from_date.isoformat(),
                "to_date": payload.to_date.isoformat(),
                "candle_count": len(candle_rows),
                "short_sma": payload.short_sma,
                "long_sma": payload.long_sma,
                "stop_loss_pct": payload.stop_loss_pct,
                "take_profit_pct": payload.take_profit_pct,
                "risk_exits_enabled": True,
                "cache_status": "miss",
                "warnings": warnings,
            },
        }
    )


def portfolio_pnl_summary(positions: dict[str, Any], holdings: list[dict[str, Any]]) -> dict[str, Any]:
    day_positions = positions.get("day") or []
    net_positions = positions.get("net") or []
    day_pnl = sum(row_float(row, "pnl") for row in day_positions)
    net_pnl = sum(row_float(row, "pnl") for row in net_positions)
    holding_pnl = sum(
        row_float(row, "pnl") or (row_float(row, "last_price") - row_float(row, "average_price")) * row_float(row, "quantity")
        for row in holdings
    )
    return {
        "day_position_pnl": round(day_pnl, 2),
        "net_position_pnl": round(net_pnl, 2),
        "holding_pnl": round(holding_pnl, 2),
        "combined_pnl": round(net_pnl + holding_pnl, 2),
        "day_positions": len(day_positions),
        "net_positions": len(net_positions),
        "holdings": len(holdings),
    }


@app.get("/api/session")
def session_status() -> dict[str, Any]:
    session = load_session()
    return {
        "authenticated": session is not None,
        "api_key": session["api_key"] if session else SANDBOX_API_KEY,
        "user_id": session.get("user_id", "") if session else "",
        "root": SANDBOX_ROOT,
        "login_url": SANDBOX_LOGIN_URL,
    }


@app.get("/api/login-url")
def login_url() -> dict[str, str]:
    return {"login_url": SANDBOX_LOGIN_URL, "api_key": SANDBOX_API_KEY}


@app.post("/api/login")
def login(payload: LoginRequest) -> dict[str, Any]:
    api_key = payload.api_key.strip()
    access_token = payload.access_token.strip()
    if access_token:
        kite = make_kite(api_key, access_token)
        try:
            profile_data = kite.profile()
        except Exception as error:
            raise HTTPException(status_code=401, detail=f"Saved UAT access token was rejected: {error}") from error
        user_id = payload.user_id.strip() or str(profile_data.get("user_id") or "")
        save_session(api_key, access_token, user_id)
        return {
            "authenticated": True,
            "user_id": user_id,
            "api_key": api_key,
            "source": "access_token",
        }

    request_token = payload.request_token.strip()
    if not request_token:
        raise HTTPException(status_code=400, detail="Provide either a request token or an access token.")
    try:
        kite = make_kite(api_key)
        session_data = kite.generate_session(
            request_token,
            api_secret=payload.api_secret.strip(),
        )
    except Exception as error:
        raise HTTPException(status_code=401, detail=f"UAT Kite login failed: {error}") from error
    save_session(
        api_key,
        session_data["access_token"],
        session_data.get("user_id"),
    )
    return {
        "authenticated": True,
        "user_id": session_data.get("user_id"),
        "api_key": api_key,
        "source": "request_token",
    }


@app.post("/api/logout")
def logout() -> dict[str, bool]:
    if SESSION_FILE.exists():
        SESSION_FILE.unlink()
    return {"authenticated": False}


@app.get("/api/profile")
def profile() -> dict[str, Any]:
    try:
        return json_safe(get_kite().profile())
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Could not fetch UAT profile: {error}") from error


@app.get("/api/instruments")
def instruments(
    exchange: str = Query(default="NSE"),
    instrument_type: str = Query(default=""),
    query: str = Query(default=""),
    limit: int = Query(default=100, ge=1, le=500),
) -> dict[str, Any]:
    return search_instrument_rows(get_kite(), exchange, instrument_type, query, limit)


@app.get("/api/instrument-search")
def instrument_search(
    query: str = Query(default=""),
    exchange: str = Query(default="NSE"),
    limit: int = Query(default=25, ge=1, le=100),
) -> dict[str, Any]:
    return search_instrument_rows(
        get_kite(),
        exchange=exchange,
        query=query,
        limit=limit,
        include_quote_fallback=True,
    )


@app.post("/api/snapshot")
def snapshot(payload: SnapshotRequest) -> dict[str, Any]:
    mode = payload.mode.strip().lower()
    if mode not in SNAPSHOT_MODES:
        raise HTTPException(status_code=400, detail="Mode must be ltp, ohlc, or quote.")
    try:
        data = getattr(get_kite(), mode)(payload.instruments)
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Could not fetch UAT {mode.upper()}: {error}") from error
    return {
        "mode": mode,
        "instruments": payload.instruments,
        "fetched_at": datetime.now().isoformat(),
        "data": json_safe(data),
    }


@app.post("/api/historical")
def historical(payload: HistoricalRequest) -> dict[str, Any]:
    interval = payload.interval.strip().lower()
    if interval not in HISTORICAL_INTERVALS:
        raise HTTPException(status_code=400, detail="Unsupported historical interval.")
    if payload.from_date > payload.to_date:
        raise HTTPException(status_code=400, detail="From date must be before To date.")
    if payload.continuous and interval != "day":
        raise HTTPException(status_code=400, detail="Continuous futures data is available for day candles only.")
    try:
        candles = historical_data_chunked(
            get_kite(),
            payload.instrument_token,
            payload.from_date,
            payload.to_date,
            interval,
            payload.continuous,
            payload.oi,
        )
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Could not fetch UAT historical candles: {error}") from error
    return {
        "instrument": {
            "instrument_token": payload.instrument_token,
            "tradingsymbol": payload.tradingsymbol,
            "exchange": payload.exchange,
        },
        "candles": candles,
        "meta": {
            "interval": interval,
            "from_date": payload.from_date.isoformat(),
            "to_date": payload.to_date.isoformat(),
            "candle_count": len(candles),
            "continuous": payload.continuous,
            "oi": payload.oi,
        },
    }


@app.post("/api/optimization-backtest")
def optimization_backtest(payload: OptimizationBacktestRequest) -> dict[str, Any]:
    return build_optimization_backtest(payload)


@app.post("/api/stock-screeners")
def stock_screeners(limit: int = Query(default=SCREENER_MAX_SYMBOLS, ge=1, le=SCREENER_MAX_SYMBOLS)) -> dict[str, Any]:
    result = build_stock_screener_result(limit)
    return {
        "status": "complete",
        "progress_pct": 100,
        "message": "UAT stock screeners are ready.",
        "result": result,
    }


@app.get("/api/stock-screener-chart")
def stock_screener_chart(
    ticker: str = Query(min_length=1),
    screener: str = Query(min_length=1),
) -> dict[str, Any]:
    screener_key = screener.strip()
    if screener_key not in STOCK_SCREENER_KEYS:
        raise HTTPException(status_code=400, detail="Unsupported stock screener.")

    symbol = ticker.strip().upper()
    kite = get_kite()
    instrument = find_nse_instrument(kite, symbol)
    if not instrument or not instrument.get("instrument_token"):
        raise HTTPException(status_code=404, detail=f"{symbol} was not found in NSE instruments.")

    to_date = date.today()
    from_date = to_date - timedelta(days=SCREENER_LOOKBACK_DAYS)
    try:
        candles = historical_data_chunked(
            kite,
            int(instrument["instrument_token"]),
            from_date,
            to_date,
            "day",
            False,
            False,
        )
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Could not fetch UAT historical candles for {symbol}: {error}") from error

    rows = valid_daily_candles(candles)
    if not rows:
        raise HTTPException(status_code=404, detail=f"No daily candles were available for {symbol}.")

    company = str(instrument.get("name") or symbol).strip() or symbol
    screeners = calculate_stock_screeners(symbol, company, candles)
    signal = screeners.get(screener_key)
    chart_candles = serialize_stock_chart_candles(rows)
    candle_dates = {row["date"] for row in chart_candles}
    latest_date = chart_candles[-1]["date"] if chart_candles else None

    if signal:
        relevant_date = str(signal.get("relevant_date") or "")
        signal["chart_marker_date"] = relevant_date if relevant_date in candle_dates else latest_date

    return {
        "ticker": symbol,
        "company": company,
        "instrument_token": int(instrument["instrument_token"]),
        "screener": screener_key,
        "signal": signal,
        "candles": chart_candles,
        "meta": {
            "from_date": from_date.isoformat(),
            "to_date": to_date.isoformat(),
            "candle_count": len(chart_candles),
            "cache": "miss",
            "served_at": datetime.now().isoformat(),
        },
    }


@app.get("/api/orders")
def orders() -> dict[str, Any]:
    kite = get_kite()
    try:
        return {
            "orders": json_safe(kite.orders()),
            "trades": json_safe(kite.trades()),
            "fetched_at": datetime.now().isoformat(),
        }
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Could not fetch UAT orders/trades: {error}") from error


@app.post("/api/orders/place")
def place_order(payload: PlaceOrderRequest) -> dict[str, Any]:
    if payload.order_type.upper() != "LIMIT":
        raise HTTPException(status_code=400, detail="Sandbox API order placement supports LIMIT orders only.")
    variety = payload.variety.strip().lower()
    if variety not in {"regular", "amo"}:
        raise HTTPException(status_code=400, detail="Order variety must be regular or amo.")
    try:
        order_id = get_kite().place_order(
            variety=variety,
            exchange=payload.exchange.strip().upper(),
            tradingsymbol=payload.tradingsymbol.strip().upper(),
            transaction_type=payload.transaction_type.strip().upper(),
            quantity=int(payload.quantity),
            product=payload.product.strip().upper(),
            order_type="LIMIT",
            price=float(payload.price),
            tag=payload.tag or "uat-dashboard",
        )
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Could not place UAT order: {error}") from error
    return {"order_id": order_id, "variety": variety, "placed_at": datetime.now().isoformat()}


@app.post("/api/orders/modify")
def modify_order(payload: ModifyOrderRequest) -> dict[str, Any]:
    kwargs: dict[str, Any] = {"variety": payload.variety, "order_id": payload.order_id}
    if payload.quantity is not None:
        kwargs["quantity"] = int(payload.quantity)
    if payload.price is not None:
        kwargs["price"] = float(payload.price)
    if payload.trigger_price is not None:
        kwargs["trigger_price"] = float(payload.trigger_price)
    if payload.order_type:
        kwargs["order_type"] = payload.order_type.strip().upper()
    try:
        order_id = get_kite().modify_order(**kwargs)
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Could not modify UAT order: {error}") from error
    return {"order_id": order_id, "modified_at": datetime.now().isoformat()}


@app.post("/api/orders/cancel")
def cancel_order(payload: CancelOrderRequest) -> dict[str, Any]:
    try:
        order_id = get_kite().cancel_order(variety=payload.variety, order_id=payload.order_id)
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Could not cancel UAT order: {error}") from error
    return {"order_id": order_id, "cancelled_at": datetime.now().isoformat()}


@app.get("/api/orders/{order_id}/history")
def order_history(order_id: str) -> dict[str, Any]:
    try:
        return {"order_id": order_id, "history": json_safe(get_kite().order_history(order_id))}
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Could not fetch UAT order history: {error}") from error


@app.get("/api/orders/{order_id}/trades")
def order_trades(order_id: str) -> dict[str, Any]:
    try:
        return {"order_id": order_id, "trades": json_safe(get_kite().order_trades(order_id))}
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Could not fetch UAT order trades: {error}") from error


@app.get("/api/portfolio")
def portfolio() -> dict[str, Any]:
    kite = get_kite()
    margins: dict[str, Any] = {}
    positions: dict[str, Any] = {"day": [], "net": []}
    holdings: list[dict[str, Any]] = []
    errors: list[str] = []
    try:
        margins = json_safe(kite.margins())
    except Exception as error:
        errors.append(f"Margins unavailable: {error}")
    try:
        positions = json_safe(kite.positions())
    except Exception as error:
        errors.append(f"Positions unavailable: {error}")
    try:
        holdings = json_safe(kite.holdings())
    except Exception as error:
        errors.append(f"Holdings unavailable: {error}")
    return {
        "margins": margins,
        "positions": positions,
        "holdings": holdings,
        "pnl": portfolio_pnl_summary(positions, holdings),
        "errors": errors,
        "fetched_at": datetime.now().isoformat(),
    }


@app.websocket("/api/realtime/ws")
async def realtime_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    session = load_session()
    if not session:
        await websocket.send_json({"type": "error", "message": "No saved UAT Kite session found."})
        await websocket.close(code=4401)
        return
    try:
        tokens = [int(token) for token in websocket.query_params.get("tokens", "").split(",") if token.strip()]
    except ValueError:
        await websocket.send_json({"type": "error", "message": "Tokens must be numeric."})
        await websocket.close(code=4400)
        return
    mode = websocket.query_params.get("mode", "ltp").lower()
    mode_map = {"ltp": KiteTicker.MODE_LTP, "quote": KiteTicker.MODE_QUOTE, "full": KiteTicker.MODE_FULL}
    if not tokens or mode not in mode_map:
        await websocket.send_json({"type": "error", "message": "Provide tokens and a valid mode."})
        await websocket.close(code=4400)
        return

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    ticker = KiteTicker(session["api_key"], session["access_token"], root=SANDBOX_WS_ROOT)
    if session.get("user_id") and "user_id=" not in ticker.socket_url:
        ticker.socket_url = f"{ticker.socket_url}&user_id={session['user_id']}"

    def push(item: dict[str, Any]) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, item)

    def on_connect(ws: KiteTicker, response: Any) -> None:
        ws.subscribe(tokens)
        ws.set_mode(mode_map[mode], tokens)
        push({"type": "status", "status": "connected", "tokens": tokens, "mode": mode})

    def on_ticks(ws: KiteTicker, ticks: list[dict[str, Any]]) -> None:
        push({"type": "ticks", "received_at": datetime.now().isoformat(), "ticks": json_safe(ticks)})

    def on_error(ws: KiteTicker, code: Any, reason: Any) -> None:
        push({"type": "error", "code": code, "message": str(reason)})

    def on_close(ws: KiteTicker, code: Any, reason: Any) -> None:
        push({"type": "status", "status": "closed", "code": code, "message": str(reason)})

    ticker.on_connect = on_connect
    ticker.on_ticks = on_ticks
    ticker.on_error = on_error
    ticker.on_close = on_close

    try:
        ticker.connect(threaded=True)
        await websocket.send_json({"type": "status", "status": "starting", "tokens": tokens, "mode": mode})
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), timeout=20)
            except asyncio.TimeoutError:
                item = {"type": "heartbeat", "received_at": datetime.now().isoformat()}
            await websocket.send_json(item)
    except WebSocketDisconnect:
        pass
    finally:
        try:
            ticker.close()
        except Exception:
            pass
