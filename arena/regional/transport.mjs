export function createRegionalTransport(onUpdate, onLog, onQueue, onLatency) {
  let ws,
    latest = { seat: -1, generation: 0, rematchVotes: [] },
    counter = 0,
    connected = false;
  const pending = new Map();
  const send = (message) => {
    if (!connected) throw Error("Regional server is disconnected");
    ws.send(JSON.stringify(message));
  };
  return {
    start() {
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/realtime`,
      );
      ws.onopen = () => {
        connected = true;
        onQueue({
          reason:
            "Measuring your connection. Choose Play ranked to join the queue.",
          ping: null,
        });
      };
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "probe")
          return send({ type: "pong", id: message.id });
        if (message.type === "hello") {
          onQueue({
            reason: "Choose Play ranked or practice while waiting.",
            demo: message.demo,
          });
          return onLog(
            message.demo
              ? "Local ranked demo: no wallet assets, gold or rating are changed."
              : "Ranked access requires a verified staked-character admission.",
          );
        }
        if (message.type === "latency") return onLatency(message);
        if (message.type === "queue") return onQueue(message);
        if (message.type === "state") {
          latest = message;
          onUpdate(message);
          return;
        }
        if (message.type === "result") {
          onLog("Result recorded. This test awards no gold or rating.");
          return;
        }
        if (message.type === "ack" || message.type === "error") {
          const request = pending.get(message.id);
          if (request) {
            clearTimeout(request.timer);
            pending.delete(message.id);
            message.error || message.type === "error"
              ? request.reject(Error(message.error || message.message))
              : request.resolve(latest);
          } else if (message.message) onLog(message.message);
        }
      };
      ws.onclose = () => {
        connected = false;
        for (const p of pending.values()) {
          clearTimeout(p.timer);
          p.reject(
            Error(
              "Connection lost. The regional authority will resolve the match.",
            ),
          );
        }
        pending.clear();
        onQueue({
          reason:
            "Disconnected. Refresh to reconnect; do not assume the match was cancelled.",
        });
      };
      return latest;
    },
    stop() {
      ws?.close();
    },
    async post(url, body = {}) {
      if (url === "/api/join" || url === "/api/rematch") {
        if (url === "/api/rematch" && latest.practice) {
          send({ type: "practice" });
          return latest;
        }
        send({
          type: "ranked",
          ticket: sessionStorage.getItem("aochain:ranked-admission"),
        });
        return latest;
      }
      if (url === "/api/cancel") {
        send({ type: "cancel" });
        return latest;
      }
      if (url === "/api/practice") {
        send({ type: "practice" });
        return latest;
      }
      if (url !== "/api/action") throw Error("Unsupported ranked action");
      const id = ++counter;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            Error(
              "Action acknowledgment timed out. Match state remains authoritative; action was not resent.",
            ),
          );
        }, 2500);
        pending.set(id, { resolve, reject, timer });
        try {
          send({ type: "action", id, ...body });
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      });
    },
  };
}
