import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
var autoCloseOnDisconnect = function () { return ({
    name: "auto-close-on-disconnect",
    apply: "serve",
    configureServer: function (server) {
        if (!server.httpServer)
            return;
        var httpServer = server.httpServer;
        var connections = 0;
        var hadConnections = false;
        var exit = function () {
            var _a;
            void ((_a = globalThis.process) === null || _a === void 0 ? void 0 : _a.exit(0));
        };
        httpServer.on("connection", function (socket) {
            hadConnections = true;
            connections += 1;
            var closed = false;
            var onClosed = function () {
                if (closed)
                    return;
                closed = true;
                connections -= 1;
            };
            socket.on("close", onClosed);
            socket.on("error", onClosed);
        });
        var watcher = setInterval(function () {
            if (hadConnections && connections <= 0) {
                clearInterval(watcher);
                exit();
            }
        }, 500);
    },
}); };
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
