import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * standalone：产出自包含的 server.js，Docker 镜像不用装完整 node_modules。
   * 镜像体积能从 1GB+ 降到 200MB 左右。
   */
  output: "standalone",

  /**
   * 商品封面来自外部域名且不可控，用原生 img 标签渲染，
   * 所以这里不需要配 remotePatterns。
   */
  images: { unoptimized: true },

  // 构建产物里不带源码路径信息
  productionBrowserSourceMaps: false,
};

export default nextConfig;
