import baseAdapter, { type Adapter } from "@marko/run/adapter";
import { mergeConfig } from "vite";
export type { NodePlatformInfo } from "@markopack/core/adapter/middleware";

export default function (): Adapter {
  const base = baseAdapter();
  return {
    ...base,
    name: "node-adapter",
    async viteConfig(config) {
      const baseConfig = await base.viteConfig?.(config);
      const adapterConfig = {
        ssr: {
          noExternal: /@markopack\/adapter-node/,
        },
      };
      return baseConfig
        ? mergeConfig(baseConfig, adapterConfig)
        : adapterConfig;
    },
    typeInfo(writer) {
      writer(`import type { NodePlatformInfo } from '@markopack/adapter-node'`);
      return "NodePlatformInfo";
    },
  };
}
