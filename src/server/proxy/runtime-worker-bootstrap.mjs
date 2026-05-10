import { installDevTsWorkerLoader } from "../dev-ts-worker-loader.mjs";

installDevTsWorkerLoader();

await import("./runtime-worker.ts");
