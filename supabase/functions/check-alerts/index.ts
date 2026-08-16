// check-alerts — scheduled Edge Function (ARCHITECTURE.md §11). Evaluates the
// runbook thresholds and writes to dashboard_alerts so the web dashboard just
// reads one table instead of computing anything itself:
//
//   * device_offline  — any device_heartbeat row older than 6 hours
//                       ("tracker may be offline", agents.md §10)
//   * parse_spike     — a package with 5+ failed parses in the last 24h
//                       (agents.md §9's "app changed its format" heuristic)
//
// Idempotent by construction: dashboard_alerts is unique on (user_id,
// alert_key), so repeats upsert with ignoreDuplicates and never stack.

import { adminClient } from "../_shared/db.ts";

const OFFLINE_AFTER_HOURS = 6;
const SPIKE_THRESHOLD = 5;

Deno.serve(async (_req) => {
  const db = adminClient();

  // ---- device_offline ------------------------------------------------------
  const { data: heartbeats, error: hbError } = await db
    .from("device_heartbeat")
    .select("device_id, user_id, last_seen_at");
  if (hbError) {
    return new Response(`heartbeat read failed: ${hbError.message}`, {
      status: 500,
    });
  }

  const staleSince = new Date(Date.now() - OFFLINE_AFTER_HOURS * 3_600_000);
  const seenDeviceIds = new Set<string>();

  for (const hb of heartbeats ?? []) {
    const stale = new Date(hb.last_seen_at) < staleSince;
    const alertKey = `device_offline:${hb.device_id}`;
    seenDeviceIds.add(hb.device_id);

    if (stale) {
      const hours = Math.round(
        (Date.now() - new Date(hb.last_seen_at).getTime()) / 3_600_000,
      );
      await db.from("dashboard_alerts").upsert(
        {
          user_id: hb.user_id,
          alert_key: alertKey,
          alert_type: "device_offline",
          severity: "warning",
          message:
            `Tracker may be offline — last heartbeat ${hours}h ago (${hb.device_id}). ` +
            `Check battery restrictions and notification access (agents.md §10).`,
          context: { device_id: hb.device_id, last_seen_at: hb.last_seen_at },
        },
        { onConflict: "user_id,alert_key", ignoreDuplicates: true },
      );
    } else {
      // Heartbeat is fresh again — clear any open offline alert for it.
      await db
        .from("dashboard_alerts")
        .update({ resolved_at: new Date().toISOString() })
        .eq("user_id", hb.user_id)
        .eq("alert_key", alertKey)
        .is("resolved_at", null);
    }
  }

  // ---- parse_spike ---------------------------------------------------------
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const { data: spikes, error: spikeError } = await db
    .from("failed_parse_spikes")
    .select("user_id, package_name, failures_24h")
    .gte("failures_24h", SPIKE_THRESHOLD);
  if (spikeError) {
    return new Response(`spike read failed: ${spikeError.message}`, {
      status: 500,
    });
  }

  for (const spike of spikes ?? []) {
    await db.from("dashboard_alerts").upsert(
      {
        user_id: spike.user_id,
        alert_key: `parse_spike:${spike.package_name}:${today}`,
        alert_type: "parse_spike",
        severity: "warning",
        message:
          `${spike.package_name} had ${spike.failures_24h} failed parses in the last 24h — ` +
          `the app may have changed its notification format.`,
        context: {
          package_name: spike.package_name,
          failures_24h: spike.failures_24h,
          date: today,
        },
      },
      { onConflict: "user_id,alert_key", ignoreDuplicates: true },
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
});
