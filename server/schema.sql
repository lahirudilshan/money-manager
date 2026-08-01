-- Shared merchant → category catalog.
--
-- The device keeps its own `merchant_rules` table (src/db/schema.ts) holding
-- PERSONAL mappings: which of the user's own budget lines a merchant belongs
-- to. That can never be shared — a subcategory id is meaningless on another
-- device, and the user's line names are their business.
--
-- What DOES generalise is the semantic bucket, plus the shape of the
-- transaction around it: "DIALOG" is telecom for everyone, and a DIALOG debit
-- of roughly 1-3k is a phone bill rather than a handset purchase. So this
-- database stores structured SIGNALS extracted from real transactions, and the
-- votes behind them.
--
-- DELIBERATELY NOT STORED, anywhere, ever:
--   * message text, in any form — raw, redacted, or templated
--   * exact amounts (only coarse buckets), balances, card/account numbers
--   * reference ids, branch names, dates, times
--   * the user's category or line names
-- The write endpoint REJECTS payloads carrying extra fields rather than
-- ignoring them, so a future client bug cannot quietly widen this.

-- One row per (merchant, hint) pair with its vote tally.
--
-- Not one row per merchant: a merchant genuinely can belong to two buckets (a
-- supermarket that also sells fuel), and collapsing early would throw away the
-- disagreement that makes `margin` meaningful. The read endpoint ranks and
-- picks per merchant at query time.
CREATE TABLE IF NOT EXISTS merchant_hints (
  id            BIGSERIAL PRIMARY KEY,
  -- Normalised merchant key, from merchantKey() in src/core/merchantRules.ts.
  -- Plain text compared by equality/containment — never executed as a pattern.
  merchant      TEXT NOT NULL,
  hint          TEXT NOT NULL CHECK (hint IN (
                  'water','electricity','telecom','groceries','fuel',
                  'subscription','loan','transfer','atm','income'
                )),
  -- Distinct devices that have confirmed this pairing.
  votes         INTEGER NOT NULL DEFAULT 0,
  -- 'seed' rows ship with the app's keyword list and carry a vote floor so a
  -- new catalog is useful before anyone contributes. 'learned' rows are built
  -- entirely from user corrections.
  source        TEXT NOT NULL DEFAULT 'learned' CHECK (source IN ('seed','learned')),
  -- Set by hand to force a merchant out of circulation (spam, bad seed). Rows
  -- are blocked rather than deleted so re-contribution cannot resurrect them.
  blocked       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Drives incremental pull: clients ask for rows changed since their cursor.
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant, hint)
);

-- Pull is always "rows changed since <cursor>", so this index carries the hot
-- read path. The column order matches the endpoint's `(updated_at, id) > (…)`
-- keyset comparison and its ORDER BY exactly — the id is part of the key
-- because timestamps are not unique, and a tie at a page boundary would
-- otherwise drop a row permanently.
CREATE INDEX IF NOT EXISTS merchant_hints_updated_idx
  ON merchant_hints (updated_at, id);

CREATE INDEX IF NOT EXISTS merchant_hints_merchant_idx
  ON merchant_hints (merchant);

-- One vote per device per merchant, so a single device cannot inflate a hint by
-- confirming the same shop every month.
--
-- `device_id` is a random UUID minted on the device and kept in its keystore. It
-- is not tied to a person, an account, or a phone number — its only job is
-- de-duplicating votes. Storing it also lets a device CHANGE its vote:
-- correcting "keells" from fuel to groceries moves this row and re-tallies both
-- hints, rather than leaving a stale vote inflating the wrong one forever.
CREATE TABLE IF NOT EXISTS merchant_votes (
  device_id     UUID NOT NULL,
  merchant      TEXT NOT NULL,
  hint          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, merchant)
);

-- Structured signals observed alongside a merchant, for ranking the 2nd and 3rd
-- suggestions rather than only the winner.
--
-- Knowing "keells is usually groceries" answers the top suggestion. What it
-- cannot do is rank the alternatives, or explain why a 45,000 debit at a
-- supermarket is probably not the weekly shop. These columns carry just enough
-- shape to do that, and nothing that identifies anybody:
--
--   sender     the SMS short code ("DIALOG", "HNB") — a public bank identifier,
--              not a phone number, and never the user's own number
--   direction  debit / credit
--   amt_bucket a COARSE band, never the amount. Bands are wide enough that a
--              row says "a mid-sized grocery spend", not "this person spent
--              4,320 rupees" — the amount itself is a personal detail and a
--              fingerprint, so it stays on the device.
CREATE TABLE IF NOT EXISTS merchant_signals (
  id            BIGSERIAL PRIMARY KEY,
  merchant      TEXT NOT NULL,
  hint          TEXT NOT NULL CHECK (hint IN (
                  'water','electricity','telecom','groceries','fuel',
                  'subscription','loan','transfer','atm','income'
                )),
  -- Bank/utility short code, uppercased. Empty string (never NULL) when the
  -- message named none: this column is part of the UNIQUE key below, and NULL
  -- never equals NULL in SQL, so a nullable column would make ON CONFLICT miss
  -- and duplicate a sender-less row on every single contribution.
  sender        TEXT NOT NULL DEFAULT '',
  direction     TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  -- Coarse band label; see AMOUNT_BUCKETS in lib/signals.ts for the boundaries.
  amt_bucket    TEXT NOT NULL,
  -- Times this exact combination has been confirmed, across all devices.
  observations  INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant, hint, sender, direction, amt_bucket)
);

-- Suggestions are looked up by merchant, and by sender when the merchant is
-- unknown (a first-ever DIALOG message still deserves a telecom guess).
CREATE INDEX IF NOT EXISTS merchant_signals_merchant_idx
  ON merchant_signals (merchant);

CREATE INDEX IF NOT EXISTS merchant_signals_sender_idx
  ON merchant_signals (sender) WHERE sender <> '';

CREATE INDEX IF NOT EXISTS merchant_signals_updated_idx
  ON merchant_signals (updated_at, id);

-- Recompute a merchant/hint pair's tally from the votes table.
--
-- Derived rather than incremented: an `UPDATE ... votes = votes + 1` drifts the
-- moment a request is retried or a vote moves between hints, and this catalog is
-- served to every user, so drift is permanent and invisible. Counting the source
-- of truth is cheap at this cardinality and always correct.
CREATE OR REPLACE FUNCTION retally(p_merchant TEXT, p_hint TEXT) RETURNS VOID AS $$
BEGIN
  UPDATE merchant_hints h
     SET votes = (
           SELECT count(*) FROM merchant_votes v
            WHERE v.merchant = p_merchant AND v.hint = p_hint
         ),
         updated_at = now()
   WHERE h.merchant = p_merchant AND h.hint = p_hint;
END;
$$ LANGUAGE plpgsql;
