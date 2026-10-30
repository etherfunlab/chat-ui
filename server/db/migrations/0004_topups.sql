-- USDC top-ups. One intent per attempted transfer; its reference key binds an
-- on-chain transaction to exactly this intent, and tx_signature is unique so
-- no transaction can ever credit twice.

CREATE TABLE topup_intents (
  id text PRIMARY KEY,
  wallet text NOT NULL REFERENCES accounts (wallet),
  amount_base bigint NOT NULL CHECK (amount_base > 0),
  reference text NOT NULL UNIQUE,
  recipient text NOT NULL,
  mint text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'submitting', 'confirmed', 'failed')),
  tx_signature text UNIQUE,
  blockhash text NOT NULL,
  last_valid_block_height bigint NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);

CREATE INDEX topup_intents_wallet_created_idx ON topup_intents (wallet, created_at DESC);

-- Marks the intent confirmed and credits the wallet in one statement pair.
-- Returns the credited amount (USDC base units = micro-USD), or 0 when the
-- intent was already confirmed, failed, or does not exist.
CREATE FUNCTION credit_topup(p_intent text, p_sig text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_wallet text;
  v_amount bigint;
BEGIN
  UPDATE topup_intents
     SET status = 'confirmed', tx_signature = p_sig, confirmed_at = now()
   WHERE id = p_intent AND status IN ('pending', 'submitting')
  RETURNING wallet, amount_base INTO v_wallet, v_amount;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  UPDATE accounts SET balance_micro = balance_micro + v_amount WHERE wallet = v_wallet;
  RETURN v_amount;
END
$$;
