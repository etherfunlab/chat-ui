CREATE TABLE accounts (
  wallet text PRIMARY KEY,
  balance_micro bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_nonces (
  nonce text PRIMARY KEY,
  wallet text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
