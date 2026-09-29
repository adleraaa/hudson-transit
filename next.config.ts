import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The generated protobuf bindings use CommonJS + dynamic requires; loading them
  // from node_modules at runtime is simpler and more reliable than bundling them.
  serverExternalPackages: ["gtfs-realtime-bindings", "protobufjs"],
  poweredByHeader: false,
};

export default nextConfig;
