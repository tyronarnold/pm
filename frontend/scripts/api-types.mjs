// Regenerates the API types from the backend: `npm run api:types`.
//
// 1. Builds only the backend stage of the Dockerfile (not the frontend, so frontend type
//    errors cannot block this) and writes the backend's OpenAPI schema to backend/openapi.json.
// 2. Generates src/lib/api-types.ts from it with openapi-typescript.
//
// openapi-typescript is run with npx at a pinned version instead of being a dependency,
// because it declares a TypeScript 5 peer dependency and this project uses TypeScript 6.
import { execFileSync, execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(frontend, "..");
const docker = (...args) => execFileSync("docker", args, { cwd: root, stdio: "inherit" });

docker("build", "-q", "--target", "backend", "-t", "pm-backend", ".");
docker(
  "run", "--rm",
  "--mount", `type=bind,source=${path.join(root, "backend")},target=/out`,
  "pm-backend", "uv", "run", "--no-sync", "python", "-m", "app.openapi", "/out/openapi.json"
);
// A fixed command string: npx needs a shell on Windows.
execSync("npx --yes openapi-typescript@7.13.0 ../backend/openapi.json -o src/lib/api-types.ts", {
  cwd: frontend,
  stdio: "inherit",
});
