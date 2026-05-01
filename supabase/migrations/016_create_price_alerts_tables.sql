CREATE TABLE IF NOT EXISTS price_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker TEXT NOT NULL,
  symbol TEXT NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('above', 'below')),
  price_side TEXT NOT NULL DEFAULT 'bid' CHECK (price_side IN ('bid', 'ask')),
  target_price DOUBLE PRECISION NOT NULL,
  note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_alerts_user_symbol
  ON price_alerts(user_id, broker, symbol, is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS price_alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES price_alerts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker TEXT NOT NULL,
  symbol TEXT NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('above', 'below')),
  price_side TEXT NOT NULL CHECK (price_side IN ('bid', 'ask')),
  target_price DOUBLE PRECISION NOT NULL,
  trigger_price DOUBLE PRECISION NOT NULL,
  note TEXT,
  fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_alert_events_user_symbol
  ON price_alert_events(user_id, broker, symbol, fired_at DESC);

ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_alert_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only access their own price alerts" ON price_alerts;
CREATE POLICY "Users can only access their own price alerts"
  ON price_alerts FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can only access their own price alert events" ON price_alert_events;
CREATE POLICY "Users can only access their own price alert events"
  ON price_alert_events FOR ALL USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE price_alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE price_alert_events;
