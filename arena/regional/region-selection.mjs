export function chooseRegion(results) {
  return (
    results
      .filter(
        (r) =>
          r.available !== false &&
          Number.isFinite(r.ping) &&
          r.ping >= 0 &&
          r.ping < 100,
      )
      .sort((a, b) => a.ping - b.ping)[0] || null
  );
}
export async function probeRegion(region) {
  return new Promise((resolve) => {
    const address = new URL("/realtime", region.url);
    address.protocol = address.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(address);
    const finish = (ping) => {
      clearTimeout(timer);
      ws.close();
      resolve({ ...region, ping });
    };
    const timer = setTimeout(() => finish(Infinity), 6500);
    ws.onmessage = (event) => {
      const m = JSON.parse(event.data);
      if (m.type === "probe")
        ws.send(JSON.stringify({ type: "pong", id: m.id }));
      if (m.type === "latency" && m.ping !== null) finish(m.ping);
    };
    ws.onerror = () => finish(Infinity);
  });
}
