import { getProviderConnections, updateProviderConnection } from "@/lib/localDb";
import { getEffectiveConnectionStatus } from "@/shared/utils/providerHealth";

function getActiveModelLocks(connection, now = Date.now()) {
  return Object.entries(connection || {})
    .filter(([key, value]) => key.startsWith("modelLock_") && value)
    .map(([key, value]) => {
      const expiry = new Date(value).getTime();
      if (!Number.isFinite(expiry) || expiry <= now) return null;
      return {
        model: key.slice("modelLock_".length),
        until: new Date(expiry).toISOString(),
      };
    })
    .filter(Boolean);
}

export const dynamic = "force-dynamic";

export async function GET() {
  const now = Date.now();
  const connections = await getProviderConnections({ isActive: true });
  const models = [];

  for (const connection of connections) {
    const locks = getActiveModelLocks(connection, now);
    for (const lock of locks) {
      models.push({
        provider: connection.provider,
        model: lock.model,
        status: "cooldown",
        until: lock.until,
        connectionId: connection.id,
        connectionName: connection.displayName || connection.name || connection.email || connection.id,
      });
    }

    const effectiveStatus = getEffectiveConnectionStatus(connection, now);
    if (effectiveStatus === "unavailable" && locks.length === 0) {
      models.push({
        provider: connection.provider,
        model: "__all",
        status: "unavailable",
        until: connection.lastErrorAt || null,
        connectionId: connection.id,
        connectionName: connection.displayName || connection.name || connection.email || connection.id,
        error: connection.lastError || null,
      });
    }
  }

  return Response.json({
    models,
    unavailableCount: models.filter((model) => model.status !== "available").length,
  }, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const { action, provider, model } = body || {};

  if (action !== "clearCooldown" || !provider || !model) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const connections = await getProviderConnections({ provider, isActive: true });
  const lockKey = `modelLock_${model}`;

  await Promise.all(connections.map(async (connection) => {
    if (!connection?.[lockKey]) return;
    const clearUpdate = {
      [lockKey]: null,
    };

    const hasOtherActiveLocks = Object.entries(connection).some(([key, value]) => {
      if (!key.startsWith("modelLock_") || key === lockKey || !value) return false;
      const expiry = new Date(value).getTime();
      return Number.isFinite(expiry) && expiry > Date.now();
    });

    if (!hasOtherActiveLocks) {
      clearUpdate.testStatus = "active";
      clearUpdate.lastError = null;
      clearUpdate.lastErrorAt = null;
      clearUpdate.errorCode = null;
      clearUpdate.backoffLevel = 0;
    }

    await updateProviderConnection(connection.id, clearUpdate);
  }));

  return Response.json({ ok: true }, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
