"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient } from "@infrastructure/db/supabase/client";

export type PriceAlertCondition = "above" | "below";
export type PriceAlertPriceSide = "bid" | "ask";

export interface PriceAlert {
  id: string;
  userId: string;
  broker: string;
  symbol: string;
  condition: PriceAlertCondition;
  priceSide: PriceAlertPriceSide;
  targetPrice: number;
  note: string | null;
  isActive: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PriceAlertEvent {
  id: string;
  alertId: string;
  userId: string;
  broker: string;
  symbol: string;
  condition: PriceAlertCondition;
  priceSide: PriceAlertPriceSide;
  targetPrice: number;
  triggerPrice: number;
  note: string | null;
  firedAt: string;
  createdAt: string;
}

interface UsePriceAlertsOptions {
  userId?: string | null;
  enabled?: boolean;
}

interface CreatePriceAlertInput {
  broker: string;
  symbol: string;
  condition: PriceAlertCondition;
  priceSide: PriceAlertPriceSide;
  targetPrice: number;
  note?: string | null;
}

interface UpdatePriceAlertInput {
  condition?: PriceAlertCondition;
  priceSide?: PriceAlertPriceSide;
  targetPrice?: number;
  note?: string | null;
  isActive?: boolean;
}

interface UsePriceAlertsResult {
  alerts: PriceAlert[];
  activeAlerts: PriceAlert[];
  recentEvents: PriceAlertEvent[];
  latestTriggeredEvent: PriceAlertEvent | null;
  loading: boolean;
  error: string | null;
  createAlert: (input: CreatePriceAlertInput) => Promise<void>;
  updateAlert: (alertId: string, input: UpdatePriceAlertInput) => Promise<void>;
  deleteAlert: (alertId: string) => Promise<void>;
  registerTriggeredEvent: (event: PriceAlertEvent) => void;
  clearLatestTriggeredEvent: () => void;
}

type AlertRow = {
  id: string;
  user_id: string;
  broker: string;
  symbol: string;
  condition: PriceAlertCondition;
  price_side: PriceAlertPriceSide;
  target_price: number;
  note: string | null;
  is_active: boolean;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
};

type AlertEventRow = {
  id: string;
  alert_id: string;
  user_id: string;
  broker: string;
  symbol: string;
  condition: PriceAlertCondition;
  price_side: PriceAlertPriceSide;
  target_price: number;
  trigger_price: number;
  note: string | null;
  fired_at: string;
  created_at: string;
};

function mapAlertRow(row: AlertRow): PriceAlert {
  return {
    id: row.id,
    userId: row.user_id,
    broker: row.broker,
    symbol: row.symbol,
    condition: row.condition,
    priceSide: row.price_side,
    targetPrice: row.target_price,
    note: row.note,
    isActive: row.is_active,
    lastTriggeredAt: row.last_triggered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAlertEventRow(row: AlertEventRow): PriceAlertEvent {
  return {
    id: row.id,
    alertId: row.alert_id,
    userId: row.user_id,
    broker: row.broker,
    symbol: row.symbol,
    condition: row.condition,
    priceSide: row.price_side,
    targetPrice: row.target_price,
    triggerPrice: row.trigger_price,
    note: row.note,
    firedAt: row.fired_at,
    createdAt: row.created_at,
  };
}

function mergeAlertRows(current: PriceAlert[], nextAlert: PriceAlert): PriceAlert[] {
  const next = current.filter((alert) => alert.id !== nextAlert.id);
  next.push(nextAlert);
  next.sort((left, right) => {
    if (left.isActive !== right.isActive) {
      return left.isActive ? -1 : 1;
    }
    return right.createdAt.localeCompare(left.createdAt);
  });
  return next;
}

function mergeAlertEventRows(current: PriceAlertEvent[], nextEvent: PriceAlertEvent): PriceAlertEvent[] {
  const next = current.filter((event) => event.id !== nextEvent.id);
  next.unshift(nextEvent);
  return next
    .sort((left, right) => right.firedAt.localeCompare(left.firedAt))
    .slice(0, 50);
}

function sortAlerts(rows: PriceAlert[]): PriceAlert[] {
  return [...rows].sort((left, right) => {
    if (left.isActive !== right.isActive) {
      return left.isActive ? -1 : 1;
    }
    return right.createdAt.localeCompare(left.createdAt);
  });
}

export function usePriceAlerts({
  userId,
  enabled = true,
}: UsePriceAlertsOptions): UsePriceAlertsResult {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [recentEvents, setRecentEvents] = useState<PriceAlertEvent[]>([]);
  const [latestTriggeredEvent, setLatestTriggeredEvent] = useState<PriceAlertEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<ReturnType<typeof getSupabaseClient>["channel"]> | null>(null);

  useEffect(() => {
    if (!enabled || !userId) {
      setAlerts([]);
      setRecentEvents([]);
      setLatestTriggeredEvent(null);
      setLoading(false);
      setError(null);
      return;
    }

    const supabase = getSupabaseClient();
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [{ data: alertRows, error: alertError }, { data: eventRows, error: eventError }] =
          await Promise.all([
            supabase
              .from("price_alerts")
              .select("*")
              .eq("user_id", userId)
              .order("created_at", { ascending: false }),
            supabase
              .from("price_alert_events")
              .select("*")
              .eq("user_id", userId)
              .order("fired_at", { ascending: false })
              .limit(50),
          ]);

        if (alertError) throw alertError;
        if (eventError) throw eventError;
        if (cancelled) return;

        setAlerts(((alertRows ?? []) as AlertRow[]).map(mapAlertRow));
        setRecentEvents(((eventRows ?? []) as AlertEventRow[]).map(mapAlertEventRow));
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load price alerts.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    const channel = supabase
      .channel(`price-alerts:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "price_alerts",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newRow = payload.new as AlertRow | null;
          const oldRow = payload.old as AlertRow | null;
          if (payload.eventType === "DELETE") {
            const deletedId = oldRow?.id;
            if (!deletedId) return;
            setAlerts((current) => current.filter((alert) => alert.id !== deletedId));
            return;
          }
          if (!newRow?.id) return;
          setAlerts((current) => mergeAlertRows(current, mapAlertRow(newRow)));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "price_alert_events",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as AlertEventRow | null;
          if (!row?.id) return;
          const nextEvent = mapAlertEventRow(row);
          setRecentEvents((current) => mergeAlertEventRows(current, nextEvent));
          setLatestTriggeredEvent(nextEvent);
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      cancelled = true;
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [enabled, userId]);

  const createAlert = useCallback(
    async (input: CreatePriceAlertInput) => {
      if (!userId) {
        throw new Error("You must be signed in to create alerts.");
      }

      const supabase = getSupabaseClient();
      setError(null);

      const payload = {
        user_id: userId,
        broker: input.broker,
        symbol: input.symbol,
        condition: input.condition,
        price_side: input.priceSide,
        target_price: input.targetPrice,
        note: input.note?.trim() || null,
        is_active: true,
        updated_at: new Date().toISOString(),
      };

      const { data: insertedRow, error: insertError } = await supabase
        .from("price_alerts")
        .insert(payload)
        .select("*")
        .single();
      if (insertError) {
        setError(insertError.message);
        throw insertError;
      }

      if (insertedRow) {
        setAlerts((current) => mergeAlertRows(current, mapAlertRow(insertedRow as AlertRow)));
      }
    },
    [userId]
  );

  const deleteAlert = useCallback(
    async (alertId: string) => {
      if (!userId) {
        throw new Error("You must be signed in to delete alerts.");
      }

      const supabase = getSupabaseClient();
      setError(null);
      const previousAlerts = alerts;
      setAlerts((current) => current.filter((alert) => alert.id !== alertId));

      const { error: deleteError } = await supabase
        .from("price_alerts")
        .delete()
        .eq("user_id", userId)
        .eq("id", alertId);

      if (deleteError) {
        setAlerts(previousAlerts);
        setError(deleteError.message);
        throw deleteError;
      }
    },
    [alerts, userId]
  );

  const updateAlert = useCallback(
    async (alertId: string, input: UpdatePriceAlertInput) => {
      if (!userId) {
        throw new Error("You must be signed in to update alerts.");
      }

      const payload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (input.condition != null) {
        payload.condition = input.condition;
      }
      if (input.priceSide != null) {
        payload.price_side = input.priceSide;
      }
      if (typeof input.targetPrice === "number" && Number.isFinite(input.targetPrice)) {
        payload.target_price = input.targetPrice;
      }
      if ("note" in input) {
        payload.note = input.note?.trim() || null;
      }
      if (typeof input.isActive === "boolean") {
        payload.is_active = input.isActive;
      }

      const supabase = getSupabaseClient();
      setError(null);
      const previousAlerts = alerts;
      setAlerts((current) =>
        sortAlerts(
          current.map((alert) =>
            alert.id !== alertId
              ? alert
              : {
                  ...alert,
                  ...(input.condition != null ? { condition: input.condition } : {}),
                  ...(input.priceSide != null ? { priceSide: input.priceSide } : {}),
                  ...(typeof input.targetPrice === "number" && Number.isFinite(input.targetPrice)
                    ? { targetPrice: input.targetPrice }
                    : {}),
                  ...("note" in input ? { note: input.note?.trim() || null } : {}),
                  ...(typeof input.isActive === "boolean" ? { isActive: input.isActive } : {}),
                  updatedAt: payload.updated_at as string,
                }
          )
        )
      );

      const { data: updatedRow, error: updateError } = await supabase
        .from("price_alerts")
        .update(payload)
        .eq("user_id", userId)
        .eq("id", alertId)
        .select("*")
        .single();

      if (updateError) {
        setAlerts(previousAlerts);
        setError(updateError.message);
        throw updateError;
      }

      if (updatedRow) {
        setAlerts((current) => mergeAlertRows(current, mapAlertRow(updatedRow as AlertRow)));
      }
    },
    [alerts, userId]
  );

  const registerTriggeredEvent = useCallback((event: PriceAlertEvent) => {
    setRecentEvents((current) => mergeAlertEventRows(current, event));
    setLatestTriggeredEvent(event);
    setAlerts((current) =>
      mergeAlertRows(
        current,
        mapAlertRow({
          id: event.alertId,
          user_id: event.userId,
          broker: event.broker,
          symbol: event.symbol,
          condition: event.condition,
          price_side: event.priceSide,
          target_price: event.targetPrice,
          note: event.note,
          is_active: false,
          last_triggered_at: event.firedAt,
          created_at:
            current.find((alert) => alert.id === event.alertId)?.createdAt ?? event.createdAt,
          updated_at: event.firedAt,
        })
      )
    );
  }, []);

  const clearLatestTriggeredEvent = useCallback(() => {
    setLatestTriggeredEvent(null);
  }, []);

  const activeAlerts = useMemo(
    () => alerts.filter((alert) => alert.isActive),
    [alerts]
  );

  return {
    alerts,
    activeAlerts,
    recentEvents,
    latestTriggeredEvent,
    loading,
    error,
    createAlert,
    updateAlert,
    deleteAlert,
    registerTriggeredEvent,
    clearLatestTriggeredEvent,
  };
}
