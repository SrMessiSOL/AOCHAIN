export function createRegionalTransport(
  onUpdate,
  onLog,
  onQueue,
  onLatency,
  onResult = () => {},
) {
  let ws,
    latest = { seat: -1, generation: 0, rematchVotes: [] },
    counter = 0,
    connected = false;
  let portalOrigins = [],
    admission = null;
  const notifyParent = (message) => {
    if (window.parent !== window)
      for (const origin of portalOrigins)
        window.parent.postMessage(message, origin);
  };
  const receiveAdmission = (event) => {
    if (
      event.source !== window.parent ||
      window.parent === window ||
      !portalOrigins.includes(event.origin) ||
      event.data?.type !== "aochain-ranked-admission" ||
      typeof event.data.ticket !== "string" ||
      event.data.ticket.length > 4096
    )
      return;
    if (admission === event.data.ticket) return;
    admission = event.data.ticket;
    send({ type: "ranked", ticket: admission });
    onQueue({
      reason:
        "Character verified. Measuring the regional connection and finding an opponent.",
      queued: true,
    });
  };
  const pending = new Map();
  const send = (message) => {
    if (!connected) throw Error("Regional server is disconnected");
    ws.send(JSON.stringify(message));
  };
  return {
    start() {
      window.addEventListener("message", receiveAdmission);
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
          portalOrigins = message.portalOrigins || [];
          onQueue({
            reason: message.demo
              ? "Choose Play ranked."
              : "Select a staked character in your AOCHAIN profile to play.",
            demo: message.demo,
          });
          notifyParent({ type: "aochain-ranked-ready" });
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
          onResult(message);
          onLog(
            message.unlocked
              ? "Result saved. Character unlocked."
              : message.receiptStatus === "pending"
                ? "Result delivery pending. Your character stays locked until it is saved."
                : "Result recorded. No gold or rating is awarded.",
          );
          if (message.unlocked)
            notifyParent({ type: "aochain-ranked-unlocked" });
          return;
        }
        if (message.type === "released") {
          onResult(message);
          admission = null;
          notifyParent({ type: "aochain-ranked-unlocked" });
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
      window.removeEventListener("message", receiveAdmission);
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
          ticket:
            admission || sessionStorage.getItem("aochain:ranked-admission"),
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
