import { getUsageStats, statsEmitter, getActiveRequests } from "@/lib/usageDb";

export const dynamic = "force-dynamic";

const VALID_PERIODS = new Set(["24h", "7d", "30d", "60d", "all"]);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "7d";

  if (!VALID_PERIODS.has(period)) {
    return new Response("Invalid period", { status: 400 });
  }

  const encoder = new TextEncoder();
  const state = { closed: false, keepalive: null, send: null, sendPending: null, cachedStats: null };

  const stream = new ReadableStream({
    async start(controller) {

      // Shared teardown — idempotent, safe to call from any error path.
      // Closes the controller so the browser receives a proper EOF and
      // EventSource fires onerror → our reconnect backoff loop kicks in.
      function teardown(reason) {
        if (state.closed) return;
        state.closed = true;
        statsEmitter.off("update", state.send);
        statsEmitter.off("pending", state.sendPending);
        if (state.keepalive !== null) {
          clearInterval(state.keepalive);
          state.keepalive = null;
        }
        if (reason) {
          console.error("[SSE] stream error — closing:", reason?.message ?? reason);
        }
        try { controller.close(); } catch { /* already closed by the runtime */ }
      }

      // Full stats refresh (heavy) + immediate lightweight push
      state.send = async () => {
        if (state.closed) return;
        try {
          // Push lightweight update immediately so UI reflects changes fast
          if (state.cachedStats) {
            const { activeRequests, recentRequests, errorProvider, pendingRequestCount } = await getActiveRequests();
            const quickStats = {
              ...state.cachedStats,
              kind: "pending",
              activeRequests,
              recentRequests,
              errorProvider,
              pendingRequestCount,
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(quickStats)}\n\n`));
          }
          // Then do full recalc and update cache
          const stats = await getUsageStats(period);
          state.cachedStats = stats;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ...stats, kind: "full" })}\n\n`));
        } catch (err) {
          teardown(err);
        }
      };

      // Lightweight push: only refresh activeRequests + recentRequests on pending changes
      state.sendPending = async () => {
        if (state.closed || !state.cachedStats) return;
        try {
          const { activeRequests, recentRequests, errorProvider, pendingRequestCount } = await getActiveRequests();
          const stats = {
            ...state.cachedStats,
            kind: "pending",
            activeRequests,
            recentRequests,
            errorProvider,
            pendingRequestCount,
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
        } catch (err) {
          teardown(err);
        }
      };

      // Initial push — if this fails, teardown() closes the stream immediately
      // so the browser gets an EOF and our backoff reconnect loop fires.
      await state.send();

      if (state.closed) return; // initial send failed — teardown already ran

      console.log(`[SSE] Client connected | update-listeners=${statsEmitter.listenerCount("update") + 1}`);

      statsEmitter.on("update", state.send);
      statsEmitter.on("pending", state.sendPending);

      state.keepalive = setInterval(() => {
        if (state.closed) {
          clearInterval(state.keepalive);
          state.keepalive = null;
          return;
        }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch (err) {
          teardown(err);
        }
      }, 25000);
    },

    cancel() {
      // Called by the runtime when the client closes the connection (tab close,
      // navigation, or our reconnect logic calling es.close()).
      // teardown() is idempotent so double-calling from error paths is safe.
      if (state.closed) return;
      state.closed = true;
      statsEmitter.off("update", state.send);
      statsEmitter.off("pending", state.sendPending);
      if (state.keepalive !== null) {
        clearInterval(state.keepalive);
        state.keepalive = null;
      }
      console.log(`[SSE] Client disconnected | update-listeners=${statsEmitter.listenerCount("update")}`);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
