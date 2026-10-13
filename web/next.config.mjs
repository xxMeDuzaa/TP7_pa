/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // El driver de MongoDB se usa solo en el servidor; no se empaqueta.
  experimental: { serverComponentsExternalPackages: ['mongodb'] },
};
export default nextConfig;
