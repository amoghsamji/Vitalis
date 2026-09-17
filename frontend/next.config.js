/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the whole app ships as plain files to S3 + CloudFront,
  // so it has no server-side compute cost at rest (see lib/frontend-stack.ts).
  output: "export",
  images: { unoptimized: true },
};

module.exports = nextConfig;
