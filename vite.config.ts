import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import crypto from 'node:crypto';
import tls from 'node:tls';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

const ASR_UPSTREAM_HOST = 'openspeech.bytedance.com';
const TTS_UPSTREAM_URL = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse';
const TTS_WS_UPSTREAM_PATH = '/api/v3/tts/unidirectional/stream';
const TTS_WS_BIDIRECTIONAL_UPSTREAM_PATH = '/api/v3/tts/bidirection';
const ASR_MODE_CONFIG = {
  bidirectional: {
    path: '/api/v3/sauc/bigmodel',
    authStyle: 'header',
  },
  nostream: {
    path: '/api/v3/sauc/bigmodel_nostream',
    authStyle: 'header',
  },
  async: {
    path: '/api/v3/sauc/bigmodel_async',
    authStyle: 'query',
  },
} as const;

function createWebSocketAccept(key: string) {
  return crypto
    .createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
}

function parseJsonBody(req: NodeJS.ReadableStream): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function isWebSocketUpgradeSuccess(responseHead: string) {
  const statusLine = responseHead.split('\r\n', 1)[0]?.trim() ?? '';
  return /^HTTP\/1\.[01] 101\b/.test(statusLine);
}

function performAsrHandshakeCheck({
  appId,
  token,
  resourceId,
  connectId,
  mode,
}: {
  appId: string;
  token: string;
  resourceId: string;
  connectId: string;
  mode: keyof typeof ASR_MODE_CONFIG;
}) {
  return new Promise<{ ok: boolean; responseHead: string; responseBody?: string }>((resolve) => {
    const upstreamConfig = ASR_MODE_CONFIG[mode];
    const upstreamSocket = tls.connect(443, ASR_UPSTREAM_HOST, { servername: ASR_UPSTREAM_HOST }, () => {
      const upstreamKey = crypto.randomBytes(16).toString('base64');
      const requestPath =
        upstreamConfig.authStyle === 'query'
          ? `${upstreamConfig.path}?api_appid=${encodeURIComponent(appId)}&api_access_key=${encodeURIComponent(token)}&api_resource_id=${encodeURIComponent(resourceId)}`
          : upstreamConfig.path;
      const requestHeaders = [
        `GET ${requestPath} HTTP/1.1`,
        `Host: ${ASR_UPSTREAM_HOST}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${upstreamKey}`,
        'Sec-WebSocket-Version: 13',
      ];

      if (upstreamConfig.authStyle === 'header') {
        requestHeaders.push(`X-Api-App-Key: ${appId}`);
        requestHeaders.push(`X-Api-Access-Key: ${token}`);
        requestHeaders.push(`X-Api-Resource-Id: ${resourceId}`);
        requestHeaders.push(`X-Api-Connect-Id: ${connectId}`);
      }

      upstreamSocket.write([...requestHeaders, '\r\n'].join('\r\n'));
    });

    let buffer = Buffer.alloc(0);
    let finished = false;
    const finish = (ok: boolean, responseHead: string, responseBody?: string) => {
      if (finished) return;
      finished = true;
      if (!upstreamSocket.destroyed) {
        upstreamSocket.destroy();
      }
      resolve({ ok, responseHead, responseBody });
    };

    upstreamSocket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const responseHead = buffer.subarray(0, headerEnd).toString('utf8');
      const body = buffer.subarray(headerEnd + 4).toString('utf8');
      finish(isWebSocketUpgradeSuccess(responseHead), responseHead, body || undefined);
    });

    upstreamSocket.on('error', (error: any) => {
      finish(false, `SOCKET_ERROR: ${error?.message ?? 'unknown error'}`);
    });

    upstreamSocket.on('end', () => {
      if (buffer.length === 0) {
        finish(false, 'SOCKET_ENDED_WITHOUT_RESPONSE');
      }
    });
  });
}

function createVolcengineProxyPlugin() {
  return {
    name: 'volcengine-dev-proxy',
    configureServer(server: any) {
      server.middlewares.use('/api/proxy/asr/check', async (req: any, res: any, next: any) => {
        if (req.method !== 'POST') {
          next();
          return;
        }

        try {
          const body = await parseJsonBody(req);
          const mode = body?.mode === 'nostream' ? 'nostream' : body?.mode === 'bidirectional' ? 'bidirectional' : 'async';
          const appId = String(body?.appId ?? '');
          const token = String(body?.token ?? '');
          const resourceId = String(body?.resourceId ?? '');

          if (!appId || !token || !resourceId) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: false, error: 'missing required asr fields' }));
            return;
          }

          const result = await performAsrHandshakeCheck({
            appId,
            token,
            resourceId,
            connectId: crypto.randomUUID(),
            mode,
          });

          res.statusCode = result.ok ? 200 : 502;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(result));
        } catch (error: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, error: error?.message || 'asr handshake check failed' }));
        }
      });

      server.middlewares.use('/api/proxy/tts/sse', async (req: any, res: any, next: any) => {
        if (req.method !== 'POST') {
          next();
          return;
        }

        try {
          const body = await parseJsonBody(req);
          const {
            appId,
            token,
            resourceId,
            text,
            speaker,
            speechRate,
            loudnessRate,
            pitchRate,
            enableSubtitle,
            reqId,
          } = body ?? {};

          if (!appId || !token || !resourceId || !text || !speaker) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'missing required tts fields' }));
            return;
          }

          const upstreamResponse = await fetch(TTS_UPSTREAM_URL, {
            method: 'POST',
            headers: {
              Accept: 'text/event-stream',
              'Content-Type': 'application/json',
              'X-Api-App-Id': String(appId),
              'X-Api-Access-Key': String(token),
              'X-Api-Resource-Id': String(resourceId),
            },
            body: JSON.stringify({
              user: {
                uid: `web_${String(reqId ?? crypto.randomUUID()).slice(0, 18)}`,
              },
              unique_id: reqId ?? crypto.randomUUID(),
              namespace: 'SpeechSynthesizer',
              req_params: {
                reqid: reqId ?? crypto.randomUUID(),
                text,
                speaker,
                audio_params: {
                  format: 'mp3',
                  sample_rate: 24000,
                  speech_rate: typeof speechRate === 'number' ? speechRate : 0,
                  loudness_rate: typeof loudnessRate === 'number' ? loudnessRate : 0,
                  pitch_rate: typeof pitchRate === 'number' ? pitchRate : 0,
                  enable_subtitle: enableSubtitle === true,
                },
              },
            }),
          });

          res.statusCode = upstreamResponse.status;
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('Content-Type', upstreamResponse.headers.get('content-type') || 'text/event-stream; charset=utf-8');

          if (!upstreamResponse.ok || !upstreamResponse.body) {
            const errorText = await upstreamResponse.text();
            res.end(errorText);
            return;
          }

          const reader = upstreamResponse.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              res.write(Buffer.from(value));
            }
          }
          res.end();
        } catch (error: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: error?.message || 'tts proxy failed' }));
        }
      });

      server.httpServer?.on('upgrade', (req: any, clientSocket: any, head: Buffer) => {
        const requestUrl = req.url ?? '';
        if (requestUrl.startsWith('/api/proxy/tts/ws-bidirectional')) {
          const parsedUrl = new URL(requestUrl, 'http://127.0.0.1');
          const appId = parsedUrl.searchParams.get('appId');
          const token = parsedUrl.searchParams.get('token');
          const resourceId = parsedUrl.searchParams.get('resourceId');
          const connectId = parsedUrl.searchParams.get('connectId') || crypto.randomUUID();
          const browserWsKey = req.headers['sec-websocket-key'];

          if (!appId || !token || !resourceId || !browserWsKey) {
            clientSocket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
            clientSocket.destroy();
            return;
          }

          const upstreamSocket = tls.connect(443, ASR_UPSTREAM_HOST, { servername: ASR_UPSTREAM_HOST }, () => {
            const upstreamKey = crypto.randomBytes(16).toString('base64');
            const requestHeaders = [
              `GET ${TTS_WS_BIDIRECTIONAL_UPSTREAM_PATH} HTTP/1.1`,
              `Host: ${ASR_UPSTREAM_HOST}`,
              'Upgrade: websocket',
              'Connection: Upgrade',
              `Sec-WebSocket-Key: ${upstreamKey}`,
              'Sec-WebSocket-Version: 13',
              `X-Api-App-Id: ${appId}`,
              `X-Api-Access-Key: ${token}`,
              `X-Api-Resource-Id: ${resourceId}`,
              `X-Api-Connect-Id: ${connectId}`,
            ];

            upstreamSocket.write([...requestHeaders, '\r\n'].join('\r\n'));
          });

          let handshakeDone = false;
          let handshakeBuffer = Buffer.alloc(0);

          upstreamSocket.on('data', (chunk) => {
            if (handshakeDone) {
              clientSocket.write(chunk);
              return;
            }

            handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
            const headerEnd = handshakeBuffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) {
              return;
            }

            const responseHead = handshakeBuffer.subarray(0, headerEnd).toString('utf8');
            if (!isWebSocketUpgradeSuccess(responseHead)) {
              console.error('[TTS WS Bidirectional Proxy] upstream handshake failed:', responseHead);
              clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
              clientSocket.end();
              upstreamSocket.end();
              return;
            }

            clientSocket.write(
              [
                'HTTP/1.1 101 Switching Protocols',
                'Upgrade: websocket',
                'Connection: Upgrade',
                `Sec-WebSocket-Accept: ${createWebSocketAccept(String(browserWsKey))}`,
                '\r\n',
              ].join('\r\n'),
            );

            handshakeDone = true;
            const remaining = handshakeBuffer.subarray(headerEnd + 4);
            if (remaining.length > 0) {
              clientSocket.write(remaining);
            }
            handshakeBuffer = Buffer.alloc(0);

            if (head.length > 0) {
              upstreamSocket.write(head);
            }

            clientSocket.on('data', (data: Buffer) => {
              if (!upstreamSocket.destroyed) {
                upstreamSocket.write(data);
              }
            });
          });

          const closeSockets = () => {
            if (!clientSocket.destroyed) {
              clientSocket.destroy();
            }
            if (!upstreamSocket.destroyed) {
              upstreamSocket.destroy();
            }
          };

          clientSocket.on('error', closeSockets);
          upstreamSocket.on('error', closeSockets);
          clientSocket.on('close', closeSockets);
          upstreamSocket.on('close', closeSockets);
          return;
        }

        if (requestUrl.startsWith('/api/proxy/tts/ws-unidirectional')) {
          const parsedUrl = new URL(requestUrl, 'http://127.0.0.1');
          const appId = parsedUrl.searchParams.get('appId');
          const token = parsedUrl.searchParams.get('token');
          const resourceId = parsedUrl.searchParams.get('resourceId');
          const browserWsKey = req.headers['sec-websocket-key'];

          if (!appId || !token || !resourceId || !browserWsKey) {
            clientSocket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
            clientSocket.destroy();
            return;
          }

          const upstreamSocket = tls.connect(443, ASR_UPSTREAM_HOST, { servername: ASR_UPSTREAM_HOST }, () => {
            const upstreamKey = crypto.randomBytes(16).toString('base64');
            const requestHeaders = [
              `GET ${TTS_WS_UPSTREAM_PATH} HTTP/1.1`,
              `Host: ${ASR_UPSTREAM_HOST}`,
              'Upgrade: websocket',
              'Connection: Upgrade',
              `Sec-WebSocket-Key: ${upstreamKey}`,
              'Sec-WebSocket-Version: 13',
              `Authorization: Bearer; ${token}`,
              `X-Api-App-Id: ${appId}`,
              `X-Api-Access-Key: ${token}`,
              `X-Api-Resource-Id: ${resourceId}`,
            ];

            upstreamSocket.write([...requestHeaders, '\r\n'].join('\r\n'));
          });

          let handshakeDone = false;
          let handshakeBuffer = Buffer.alloc(0);

          upstreamSocket.on('data', (chunk) => {
            if (handshakeDone) {
              clientSocket.write(chunk);
              return;
            }

            handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
            const headerEnd = handshakeBuffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) {
              return;
            }

            const responseHead = handshakeBuffer.subarray(0, headerEnd).toString('utf8');
            if (!isWebSocketUpgradeSuccess(responseHead)) {
              console.error('[TTS WS Proxy] upstream handshake failed:', responseHead);
              clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
              clientSocket.end();
              upstreamSocket.end();
              return;
            }

            clientSocket.write(
              [
                'HTTP/1.1 101 Switching Protocols',
                'Upgrade: websocket',
                'Connection: Upgrade',
                `Sec-WebSocket-Accept: ${createWebSocketAccept(String(browserWsKey))}`,
                '\r\n',
              ].join('\r\n'),
            );

            handshakeDone = true;
            const remaining = handshakeBuffer.subarray(headerEnd + 4);
            if (remaining.length > 0) {
              clientSocket.write(remaining);
            }
            handshakeBuffer = Buffer.alloc(0);

            if (head.length > 0) {
              upstreamSocket.write(head);
            }

            clientSocket.on('data', (data: Buffer) => {
              if (!upstreamSocket.destroyed) {
                upstreamSocket.write(data);
              }
            });
          });

          const closeSockets = () => {
            if (!clientSocket.destroyed) {
              clientSocket.destroy();
            }
            if (!upstreamSocket.destroyed) {
              upstreamSocket.destroy();
            }
          };

          clientSocket.on('error', closeSockets);
          upstreamSocket.on('error', closeSockets);
          clientSocket.on('close', closeSockets);
          upstreamSocket.on('close', closeSockets);
          return;
        }

        if (!requestUrl.startsWith('/api/proxy/asr')) {
          return;
        }

        const parsedUrl = new URL(requestUrl, 'http://127.0.0.1');
        const appId = parsedUrl.searchParams.get('appId');
        const token = parsedUrl.searchParams.get('token');
        const resourceId = parsedUrl.searchParams.get('resourceId');
        const connectId = parsedUrl.searchParams.get('connectId') || crypto.randomUUID();
        const modeParam = parsedUrl.searchParams.get('mode');
        const mode =
          modeParam === 'nostream'
            ? 'nostream'
            : modeParam === 'bidirectional'
              ? 'bidirectional'
              : 'async';
        const browserWsKey = req.headers['sec-websocket-key'];
        const upstreamConfig = ASR_MODE_CONFIG[mode];

        if (!appId || !token || !resourceId || !browserWsKey) {
          clientSocket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
          clientSocket.destroy();
          return;
        }

        const upstreamSocket = tls.connect(443, ASR_UPSTREAM_HOST, { servername: ASR_UPSTREAM_HOST }, () => {
          const upstreamKey = crypto.randomBytes(16).toString('base64');
          const requestPath =
            upstreamConfig.authStyle === 'query'
              ? `${upstreamConfig.path}?api_appid=${encodeURIComponent(appId)}&api_access_key=${encodeURIComponent(token)}&api_resource_id=${encodeURIComponent(resourceId)}`
              : upstreamConfig.path;
          const requestHeaders = [
            `GET ${requestPath} HTTP/1.1`,
            `Host: ${ASR_UPSTREAM_HOST}`,
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Key: ${upstreamKey}`,
            'Sec-WebSocket-Version: 13',
          ];

          if (upstreamConfig.authStyle === 'header') {
            requestHeaders.push(`X-Api-App-Key: ${appId}`);
            requestHeaders.push(`X-Api-Access-Key: ${token}`);
            requestHeaders.push(`X-Api-Resource-Id: ${resourceId}`);
            requestHeaders.push(`X-Api-Connect-Id: ${connectId}`);
          }

          upstreamSocket.write(
            [...requestHeaders, '\r\n'].join('\r\n'),
          );
        });

        let handshakeDone = false;
        let handshakeBuffer = Buffer.alloc(0);

        upstreamSocket.on('data', (chunk) => {
          if (handshakeDone) {
            clientSocket.write(chunk);
            return;
          }

          handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
          const headerEnd = handshakeBuffer.indexOf('\r\n\r\n');
          if (headerEnd === -1) {
            return;
          }

          const responseHead = handshakeBuffer.subarray(0, headerEnd).toString('utf8');
          if (!isWebSocketUpgradeSuccess(responseHead)) {
            console.error('[ASR Proxy] upstream handshake failed:', responseHead);
            clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
            clientSocket.end();
            upstreamSocket.end();
            return;
          }

          clientSocket.write(
            [
              'HTTP/1.1 101 Switching Protocols',
              'Upgrade: websocket',
              'Connection: Upgrade',
              `Sec-WebSocket-Accept: ${createWebSocketAccept(String(browserWsKey))}`,
              '\r\n',
            ].join('\r\n'),
          );

          handshakeDone = true;
          const remaining = handshakeBuffer.subarray(headerEnd + 4);
          if (remaining.length > 0) {
            clientSocket.write(remaining);
          }
          handshakeBuffer = Buffer.alloc(0);

          if (head.length > 0) {
            upstreamSocket.write(head);
          }

          clientSocket.on('data', (data: Buffer) => {
            if (!upstreamSocket.destroyed) {
              upstreamSocket.write(data);
            }
          });
        });

        const closeSockets = () => {
          if (!clientSocket.destroyed) {
            clientSocket.destroy();
          }
          if (!upstreamSocket.destroyed) {
            upstreamSocket.destroy();
          }
        };

        clientSocket.on('error', closeSockets);
        upstreamSocket.on('error', closeSockets);
        clientSocket.on('close', closeSockets);
        upstreamSocket.on('close', closeSockets);
      });
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), createVolcengineProxyPlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
