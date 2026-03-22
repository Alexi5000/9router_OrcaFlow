"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";

const LOG_LEVEL_COLORS = {
  LOG: "text-green-400",
  INFO: "text-blue-400",
  WARN: "text-yellow-400",
  ERROR: "text-red-400",
  DEBUG: "text-purple-400",
};

function colorLine(line) {
  const match = line.match(/\[(LOG|INFO|WARN|ERROR|DEBUG)\]/);
  const levelTag = match ? match[1] : null;
  const color = LOG_LEVEL_COLORS[levelTag] || "text-green-400";
  return <span className={color}>{line}</span>;
}

export default function ConsoleLogClient() {
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);
  const logRef = useRef(null);

  const applyLogs = (incomingLogs) => {
    setLogs(incomingLogs.slice(-CONSOLE_LOG_CONFIG.maxLines));
  };

  const refreshLogs = async () => {
    try {
      const response = await fetch("/api/translator/console-logs", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      if (payload?.success && Array.isArray(payload.logs)) {
        applyLogs(payload.logs);
      }
    } catch (err) {
      console.error("Failed to refresh console logs:", err);
    }
  };

  const handleClear = async () => {
    try {
      await fetch("/api/translator/console-logs", { method: "DELETE" });
      // UI cleared via SSE "clear" event
    } catch (err) {
      console.error("Failed to clear console logs:", err);
    }
  };

  useEffect(() => {
    refreshLogs();

    const es = new EventSource("/api/translator/console-logs/stream");
    let fallbackPoll = null;

    es.onopen = () => {
      setConnected(true);
      if (fallbackPoll) {
        clearInterval(fallbackPoll);
        fallbackPoll = null;
      }
    };

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "init") {
        applyLogs(msg.logs);
      } else if (msg.type === "line") {
        setLogs((prev) => {
          const next = [...prev, msg.line];
          return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
        });
      } else if (msg.type === "clear") {
        setLogs([]);
      }
    };

    es.onerror = () => {
      setConnected(false);
      if (!fallbackPoll) {
        fallbackPoll = setInterval(refreshLogs, 5000);
      }
    };

    return () => {
      es.close();
      if (fallbackPoll) {
        clearInterval(fallbackPoll);
      }
    };
  }, []);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  return (
    <div className="">
      <Card>
        <div className="flex items-center justify-end px-4 pt-3 pb-2">
          <span className={`mr-auto text-xs ${connected ? "text-green-500" : "text-yellow-500"}`}>
            {connected ? "Live stream connected" : "Polling fallback"}
          </span>
          <Button size="sm" variant="outline" icon="delete" onClick={handleClear}>
            Clear
          </Button>
        </div>
        <div
          ref={logRef}
          className="bg-black rounded-b-lg p-4 text-xs font-mono h-[calc(100vh-220px)] overflow-y-auto"
        >
          {logs.length === 0 ? (
            <span className="text-text-muted">No console logs yet.</span>
          ) : (
            <div className="space-y-0.5">
              {logs.map((line, i) => (
                <div key={i}>{colorLine(line)}</div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
