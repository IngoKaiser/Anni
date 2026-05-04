/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // YAML-Files in tenants/ als externe Resourcen behandeln (nicht bundeln)
  outputFileTracingIncludes: {
    '/api/**/*': ['./tenants/**/*'],
    '/': ['./tenants/**/*'],
  },
};
export default nextConfig;
