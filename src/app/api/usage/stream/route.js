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
      // Full stats refresh (heavy) + immediate lightweight push
      state.send = async () => {
        if (state.closed) return;
        try {
          // Push lightweight update immediately so UI reflects changes fast
          if (state.cachedStats) {
            const { activeRequests, recentRequests, errorProvider } = await getActiveRequests();
            const quickStats = {
              ...state.cachedStats,
              kind: "pending",
              activeRequests,
              recentRequests,
              errorProvider,
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(quickStats)}\n\n`));
          }
          // Then do full recalc and update cache
          const stats = await getUsageStats(period);
          state.cachedStats = stats;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ...stats, kind: "full" })}\n\n`));
        } catch {
          state.closed = true;
          statsEmitter.off("update", state.send);
          statsEmitter.off("pending", state.sendPending);
          clearInterval(state.keepalive);
        }
      };

      // Lightweight push: only refresh activeRequests + recentRequests on pending changes
      state.sendPending = async () => {
        if (state.closed || !state.cachedStats) return;
        try {
          const { activeRequests, recentRequests, errorProvider } = await getActiveRequests();
          const stats = {
            ...state.cachedStats,
            kind: "pending",
            activeRequests,
            recentRequests,
            errorProvider,
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
        } catch {
          state.closed = true;
          statsEmitter.off("pending", state.sendPending);
        }
      };

      await state.send();
      console.log(`[SSE] Client connected | listeners=${statsEmitter.listenerCount("update") + 1}`);

      statsEmitter.on("update", state.send);
      statsEmitter.on("pending", state.sendPending);

      state.keepalive = setInterval(() => {
        if (state.closed) { clearInterval(state.keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          state.closed = true;
          clearInterval(state.keepalive);
        }
      }, 25000);
    },

    cancel() {
      state.closed = true;
      statsEmitter.off("update", state.send);
      statsEmitter.off("pending", state.sendPending);
      clearInterval(state.keepalive);
      console.log("[SSE] Client disconnected");
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
