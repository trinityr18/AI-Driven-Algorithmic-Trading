# Kite Connect Sandbox/UAT Reference

This is the source of truth for this dashboard. Prefer this file over production Kite Connect assumptions.

## Credentials And Roots

- API key: `sandboxdemo`
- API secret: `sandboxdemo-secret`
- REST API root: `https://sandbox.kite.trade`
- Login URL: `https://sandbox.kite.trade/connect/login?api_key=sandboxdemo`
- WebSocket root: `wss://ws-sandbox.kite.trade`

Sandbox uses shared demo credentials and does not represent real money.

## SDK Route Patch

`pykiteconnect` routes must be patched after creating `KiteConnect`.

Keep these routes unmodified:

- `market.instruments.all`
- `market.instruments`

Prefix every other SDK route with `/oms`.

## Login Flow

1. Open `https://sandbox.kite.trade/connect/login?api_key=sandboxdemo`.
2. Copy the `request_token` from the redirect URL.
3. Call `kite.generate_session(request_token, api_secret="sandboxdemo-secret")`.
4. Save `access_token` and `user_id`.

The request token is single-use and short-lived. The dashboard stores the access token locally in
`backend/.kite_uat_session.json`.

## Market Data

Use normal instrument keys such as:

- `NSE:HDFCBANK`
- `NSE:RELIANCE`

Supported examples:

- `kite.quote(["NSE:HDFCBANK"])`
- `kite.ohlc(["NSE:HDFCBANK"])`
- `kite.ltp(["NSE:HDFCBANK"])`
- `kite.historical_data(reliance_token, "2026-01-01", "2026-07-16", "day")`

For historical day candles, split very wide ranges into chunks of about 1900 days. For intraday intervals, use much
smaller chunks.

## WebSocket Ticker

Sandbox WebSocket requires `user_id` in the ticker URL. `KiteTicker` does not add it automatically.

Required pattern:

```python
kws = KiteTicker(api_key, access_token, root="wss://ws-sandbox.kite.trade")
kws.socket_url = f"{kws.socket_url}&user_id={user_id}"
```

Then subscribe after connect:

```python
def on_connect(ws, response):
    ws.subscribe([instrument_token])
    ws.set_mode(ws.MODE_FULL, [instrument_token])
```

The local FastAPI server also needs a WebSocket protocol package. This dashboard uses the `websockets` Python package
for Uvicorn WebSocket upgrades.

## Orders

Only API `LIMIT` orders are supported in this sandbox. Do not use API `MARKET` orders.

Keep limit prices close to LTP. Prices too far away, roughly 20% or more from LTP, can be rejected by price-band checks.

## Known Unsupported Sandbox Calls

Do not rely on:

- `trigger_range()`
- GTT APIs such as `get_gtts()` and `place_gtt()`
- `order_margins()`
- `basket_order_margins()`
- `get_virtual_contract_note()`
- API `MARKET` order placement
