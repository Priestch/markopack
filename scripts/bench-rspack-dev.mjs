import { dev } from "@markopack/rspack";
const root = process.argv[2];
const port = Number(process.argv[3]) || 4200;
dev({ root, port, mode: "development" });
