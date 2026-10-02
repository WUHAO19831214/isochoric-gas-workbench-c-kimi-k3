import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
  },
  // tesseract.js 默认从 CDN 加载 worker 与语言数据；
  // 教室离线部署时可将资源放入 public/tesseract/ 并参考 README 配置。
  optimizeDeps: {
    include: ['three', 'tesseract.js'],
  },
  build: {
    emptyOutDir: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
