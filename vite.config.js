import {defineConfig} from 'vite';
import {resolve} from 'node:path';
export default defineConfig({base:'./',build:{rollupOptions:{input:{popup:resolve('index.html'),background:resolve('src/background.js'),offscreen:resolve('src/offscreen.js')},output:{entryFileNames: chunk=> ['background','offscreen'].includes(chunk.name)?'[name].js':'assets/[name]-[hash].js'}}}});
