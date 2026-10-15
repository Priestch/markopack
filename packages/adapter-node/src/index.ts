import type { Adapter } from "@markopack/core/types";
export type { NodePlatformInfo } from "@markopack/core/adapter/middleware";

export default function (): Adapter {
  return {
    name: "node-adapter",
    typeInfo(writer) {
      writer(`import type { NodePlatformInfo } from '@markopack/adapter-node'`);
      return "NodePlatformInfo";
    },
  };
}
