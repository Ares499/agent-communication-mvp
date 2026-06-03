import { spawn } from "node:child_process";

const children = [
  spawn("node", ["server/server.mjs"], { stdio: "inherit", shell: true }),
  spawn("npx", ["vite", "--host", "0.0.0.0"], { stdio: "inherit", shell: true })
];

function stop() {
  for (const child of children) child.kill("SIGTERM");
}

process.on("SIGINT", () => {
  stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});
