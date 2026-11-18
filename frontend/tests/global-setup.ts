import { execFileSync } from "node:child_process";
import path from "node:path";

// The e2e tests run against their own container, so they never touch the real
// board in the `pm` container (port 8000) or its `pm-data` volume. The test
// container has no volume: every run starts with an empty database, and the
// container is removed when the run ends.
export const TEST_PORT = 8001;
const CONTAINER = "pm-test";
const ROOT = path.resolve(__dirname, "../..");

const docker = (...args: string[]) =>
  execFileSync("docker", args, { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });

const removeContainer = () => {
  try {
    execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
  } catch {
    // Not running: nothing to remove.
  }
};

const waitUntilHealthy = async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${TEST_PORT}/api/health`)).ok) {
        return;
      }
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The ${CONTAINER} container did not become healthy on port ${TEST_PORT}`);
};

export default async function globalSetup() {
  // Build from the current code (fast when nothing changed, thanks to Docker's cache).
  docker("build", "-q", "-t", "pm", ".");
  removeContainer(); // left over from an interrupted run
  docker(
    "run", "-d", "--rm", "--name", CONTAINER,
    "-p", `${TEST_PORT}:8000`,
    "--env-file", ".env", // the chat test calls the real AI
    "pm"
  );
  await waitUntilHealthy();
  return removeContainer; // Playwright runs this after all tests
}
