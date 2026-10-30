-- Ledger: balances with holds, API keys (managed in a later migration's
-- endpoints), and per-request usage records. Usage rows hold metering only —
-- never conversation content.

ALTER TABLE accounts ADD COLUMN held_micro bigint NOT NULL DEFAULT 0 CHECK (held_micro >= 0);

CREATE TABLE api_keys (
  id text PRIMARY KEY,
  wallet text NOT NULL REFERENCES accounts (wallet),
  name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE usage_records (
  id text PRIMARY KEY,
  wallet text NOT NULL REFERENCES accounts (wallet),
  api_key_id text REFERENCES api_keys (id),
  endpoint text NOT NULL CHECK (endpoint IN ('chat', 'responses')),
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'ok', 'aborted', 'error')),
  hold_micro bigint NOT NULL DEFAULT 0 CHECK (hold_micro >= 0),
  cost_micro bigint NOT NULL DEFAULT 0 CHECK (cost_micro >= 0),
  input_tokens integer,
  cached_input_tokens integer,
  cache_write_tokens integer,
  output_tokens integer,
  reasoning_tokens integer,
  web_search boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

CREATE INDEX usage_records_wallet_created_idx ON usage_records (wallet, created_at DESC);
CREATE INDEX usage_records_pending_idx ON usage_records (wallet) WHERE status = 'pending';

-- Authenticates (wallet or API key hash) and places a hold in one round trip.
-- Lock order everywhere: api_keys row → accounts row → usage_records rows.
-- Pending charges older than 15 minutes belong to a dead request (functions
-- time out well before that); their holds are released here.
CREATE FUNCTION open_charge(
  p_id text, p_wallet text, p_key_hash text, p_billing boolean, p_allowed text[],
  p_want bigint, p_min bigint, p_endpoint text, p_model text
) RETURNS TABLE (r_status text, r_wallet text, r_api_key_id text, r_hold text, r_available text)
LANGUAGE plpgsql AS $$
DECLARE
  v_wallet text := p_wallet;
  v_key_id text;
  v_balance bigint;
  v_held bigint;
  v_stale bigint;
  v_available bigint;
  v_hold bigint;
BEGIN
  IF p_want IS NULL OR p_min IS NULL OR p_min < 0 OR p_want < p_min THEN
    RAISE EXCEPTION 'open_charge: invalid hold bounds (want %, min %)', p_want, p_min;
  END IF;

  IF p_key_hash IS NOT NULL THEN
    UPDATE api_keys SET last_used_at = now()
      WHERE key_hash = p_key_hash AND revoked_at IS NULL
      RETURNING id, wallet INTO v_key_id, v_wallet;
    IF v_key_id IS NULL THEN
      RETURN QUERY SELECT 'invalid_key'::text, NULL::text, NULL::text, NULL::text, NULL::text;
      RETURN;
    END IF;
  END IF;

  IF p_allowed IS NOT NULL AND (v_wallet IS NULL OR NOT (v_wallet = ANY (p_allowed))) THEN
    RETURN QUERY SELECT 'forbidden'::text, v_wallet, v_key_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT a.balance_micro, a.held_micro INTO v_balance, v_held
    FROM accounts a WHERE a.wallet = v_wallet FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'forbidden'::text, v_wallet, v_key_id, NULL::text, NULL::text;
    RETURN;
  END IF;

  WITH released AS (
    UPDATE usage_records u SET status = 'error', settled_at = now()
     WHERE u.wallet = v_wallet AND u.status = 'pending'
       AND u.created_at < now() - interval '15 minutes'
     RETURNING u.hold_micro
  )
  SELECT coalesce(sum(hold_micro), 0) INTO v_stale FROM released;
  IF v_stale > 0 THEN
    v_held := v_held - v_stale;
    UPDATE accounts SET held_micro = v_held WHERE wallet = v_wallet;
  END IF;

  IF NOT p_billing THEN
    INSERT INTO usage_records (id, wallet, api_key_id, endpoint, model, status, hold_micro)
      VALUES (p_id, v_wallet, v_key_id, p_endpoint, p_model, 'pending', 0);
    RETURN QUERY SELECT 'ok'::text, v_wallet, v_key_id, '0'::text, NULL::text;
    RETURN;
  END IF;

  v_available := v_balance - v_held;
  IF v_available < p_min THEN
    RETURN QUERY SELECT 'insufficient_balance'::text, v_wallet, v_key_id, NULL::text, v_available::text;
    RETURN;
  END IF;

  v_hold := least(p_want, v_available);
  UPDATE accounts SET held_micro = held_micro + v_hold WHERE wallet = v_wallet;
  INSERT INTO usage_records (id, wallet, api_key_id, endpoint, model, status, hold_micro)
    VALUES (p_id, v_wallet, v_key_id, p_endpoint, p_model, 'pending', v_hold);
  RETURN QUERY SELECT 'ok'::text, v_wallet, v_key_id, v_hold::text, v_available::text;
END
$$;

-- Settles a pending charge exactly once: a retry, or a charge already released
-- as stale, is a no-op. Cost may exceed the hold (estimates are estimates);
-- the balance then dips slightly negative and the next open_charge refuses.
CREATE FUNCTION settle_charge(
  p_id text, p_status text, p_cost bigint, p_billing boolean, p_usage jsonb
) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_wallet text;
  v_hold bigint;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('ok', 'aborted', 'error') OR p_cost IS NULL OR p_cost < 0 THEN
    RAISE EXCEPTION 'settle_charge: invalid settlement (status %, cost %)', p_status, p_cost;
  END IF;

  SELECT wallet INTO v_wallet FROM usage_records WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN 'noop';
  END IF;
  PERFORM 1 FROM accounts WHERE wallet = v_wallet FOR UPDATE;

  UPDATE usage_records SET
    status = p_status,
    cost_micro = p_cost,
    settled_at = now(),
    input_tokens = (p_usage ->> 'inputTokens')::integer,
    cached_input_tokens = (p_usage ->> 'cachedInputTokens')::integer,
    cache_write_tokens = (p_usage ->> 'cacheWriteTokens')::integer,
    output_tokens = (p_usage ->> 'outputTokens')::integer,
    reasoning_tokens = (p_usage ->> 'reasoningTokens')::integer,
    web_search = coalesce((p_usage ->> 'webSearch')::boolean, false)
  WHERE id = p_id AND status = 'pending'
  RETURNING hold_micro INTO v_hold;
  IF NOT FOUND THEN
    RETURN 'noop';
  END IF;

  UPDATE accounts SET
    held_micro = held_micro - v_hold,
    balance_micro = balance_micro - CASE WHEN p_billing THEN p_cost ELSE 0 END
  WHERE wallet = v_wallet;
  RETURN 'settled';
END
$$;
