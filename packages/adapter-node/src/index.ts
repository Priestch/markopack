import baseAdapter, { type Adapter } from "@marko/run/adapter";
export type { NodePlatformInfo } from "@markopack/core/adapter/middleware";

export default function (): Adapter {
  const base = baseAdapter();
  return {
    ...base,
    name: "node-adapter",
    typeInfo(writer) {
      writer(`import type { NodePlatformInfo } from '@markopack/adapter-node'`);
      return "NodePlatformInfo";
    },
  };
}
