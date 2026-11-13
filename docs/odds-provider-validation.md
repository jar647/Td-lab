# Odds provider validation

NBA and NFL share the existing OddsPapi account. Production odds writers run in
the same concurrency group and publish a shared public catalog cache and safe
cooldown metadata. Fixtures expire after 10 minutes; markets and tournaments
expire after 24 hours. Prices are never cached by this transport.

An HTTP 429 stops the attempt immediately. `Retry-After` determines the next
attempt; a missing or invalid header uses 15 minutes. A saved cooldown prevents
the other sport from immediately spending another request. No API key, request
URL, authorization header, or raw error body is published.

The live-input CI evidence records one of two modes:

- `FRESH_PRICES_VERIFIED`: the provider returned actual supported active prices,
  the price file is current, and every quote is at most one hour old.
- `RESEARCH_ONLY_PROVIDER_RATE_LIMITED`: an identified HTTP 429 or its persisted
  cooldown prevented pricing. The previous price file must remain byte-for-byte
  unchanged. Tests verify that stale and future quotes remain ineligible. This
  mode explicitly records `live_price_verified: false` and `priced_path:
  UNVERIFIED`; passing research validation does not verify live-priced bets.

Authentication failures, missing credentials, unsupported responses and unknown
provider failures still fail the live-input gate. CI uploads the sanitized NBA
status, current analysis and validation evidence as `nba-live-input-evidence`.
The account's quota can still require a provider reset or account change; this
code cannot create quota or manufacture sportsbook prices.
