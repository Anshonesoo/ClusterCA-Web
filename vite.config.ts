import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";

const autoCloseOnDisconnect = (): Plugin => ({
  name: "auto-close-on-disconnect",
  apply: "serve",
  configureServer(server) {
    if (!server.httpServer) return;
    const httpServer = server.httpServer as unknown as {
      on(event: "connection", listener: (socket: {
        on(event: "close" | "error", listener: () => void): void;
      }) => void): void;
    };
    let connections = 0;
    let hadConnections = false;
    const exit = (): void => {
      void (globalThis as { process?: { exit(code?: number): void } }).process?.exit(0);
    };
    httpServer.on("connection", (socket) => {
      hadConnections = true;
      connections += 1;
      let closed = false;
      const onClosed = (): void => {
        if (closed) return;
        closed = true;
        connections -= 1;
      };
      socket.on("close", onClosed);
      socket.on("error", onClosed);
    });
    const watcher = setInterval(() => {
      if (hadConnections && connections <= 0) {
        clearInterval(watcher);
        exit();
      }
    }, 500);
  },
});

export default defineConfig({
  base: "./",
  plugins: [preact(), autoCloseOnDisconnect()],
  build: {
    target: "es2022",
    sourcemap: true,
  },
  worker: {
    format: "es",
  },
});
