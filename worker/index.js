import { handlePitchApi } from './pitchapi.js';

// The build replaces this marker with an explicit, reviewed asset dictionary.
// Raw project files and runtime configuration are never included.
const assets = /* ORION_PUBLIC_ASSETS */ {};

export default {
  async fetch(request, env, ctx) {
    void ctx;
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return handlePitchApi(request, env);
    }
    const headers = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
    }
    let pathname = url.pathname;
    if (pathname === '/dashboard') pathname = '/';
    else if (pathname.startsWith('/dashboard/')) pathname = pathname.slice('/dashboard'.length);
    if (pathname === '/') pathname = '/index.html';
    if (!Object.hasOwn(assets, pathname)) return new Response('Not found', { status: 404, headers });
    const asset = assets[pathname];
    const body=request.method==='HEAD'?null:asset.encoding==='base64'?Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0)):asset.body;
    return new Response(body, {
      headers: { ...headers, 'Content-Type': asset.type },
    });
  },
};
