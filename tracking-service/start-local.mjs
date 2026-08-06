import { randomBytes } from "node:crypto";
import { OpenSignalStore } from "./open-signal-store.mjs";
import { createOpenSignalServer } from "./open-signal-server.mjs";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.OPEN_SIGNAL_PORT || "8787", 10);
const pepper = process.env.OPEN_SIGNAL_PEPPER || randomBytes(32).toString("base64url");
const store = new OpenSignalStore({ pepper });
const server = createOpenSignalServer({ store });

server.listen(port, host, () => {
  console.log(`Local open-signal service listening on http://${host}:${port}`);
  console.log("Data is in memory only and is erased when this process stops.");
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
