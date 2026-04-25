/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback, type MouseEvent } from 'react';
import Navbar from './components/layout/Navbar';
import ConfigBar from './components/layout/ConfigBar';
import TTSDemo from './components/tts/TTSDemo';
import ASRDemo from './components/asr/ASRDemo';
import { KeyRound, Settings, X, Terminal } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { buildSpeechCredential, getJwtRemainingSeconds, type AuthMode, type SpeechConfig } from './utils/auth';

const DEFAULT_CONFIG: SpeechConfig = {
  appId: '',
  token: '',
  authMode: 'access-token',
  jwtToken: '',
  jwtExpiresAt: null,
};

export default function App() {
  const [config, setConfig] = useState<SpeechConfig>(() => {
    const saved = localStorage.getItem('volengine_demo_config');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_CONFIG, ...parsed };
    }
    return DEFAULT_CONFIG;
  });
  const [showSettings, setShowSettings] = useState(!config.appId);
  const [logs, setLogs] = useState<{ time: string; type: string; msg: string }[]>([]);
  const [isFetchingJwt, setIsFetchingJwt] = useState(false);

  useEffect(() => {
    localStorage.setItem('volengine_demo_config', JSON.stringify(config));
  }, [config]);

  const addLog = (type: string, msg: string) => {
    const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setLogs(prev => [{ time: now, type, msg }, ...prev].slice(0, 50));
  };

  const activeCredential = buildSpeechCredential(config);
  const runtimeConfig = { ...config, token: activeCredential };
  const jwtRemainingSeconds = getJwtRemainingSeconds(config.jwtExpiresAt);
  const jwtAvailable = Boolean(config.jwtToken && jwtRemainingSeconds !== null && jwtRemainingSeconds > 0);

  const updateAuthMode = (authMode: AuthMode) => {
    setConfig((prev) => ({ ...prev, authMode }));
  };

  const fetchJwtToken = async () => {
    if (!config.appId || !config.token) {
      addLog('Error', '请先填写 App ID 和长期 Access Token，再获取 JWT 测试 token');
      return;
    }

    setIsFetchingJwt(true);
    try {
      const duration = 3600;
      const response = await fetch('/api/token/jwt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: config.appId,
          token: config.token,
          duration,
        }),
      });
      const data = await response.json();

      if (!response.ok || !data?.ok || !data?.jwtToken) {
        addLog('Error', `获取 JWT token 失败: ${data?.error ?? `HTTP ${response.status}`}`);
        return;
      }

      setConfig((prev) => ({
        ...prev,
        jwtToken: data.jwtToken,
        jwtExpiresAt: Date.now() + (Number(data.duration ?? duration) * 1000),
        authMode: 'jwt-test',
      }));
      addLog('Success', `已获取方案1 JWT token，有效期约 ${Math.floor(Number(data.duration ?? duration) / 60)} 分钟，已切换到 JWT 测试模式`);
    } catch (err: any) {
      addLog('Error', `获取 JWT token 异常: ${err?.message ?? '未知错误'}`);
    } finally {
      setIsFetchingJwt(false);
    }
  };

  // ── Draggable console divider ─────────────────────────────────────────────
  const [consoleHeight, setConsoleHeight] = useState(140);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const onDragStart = useCallback((e: MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = consoleHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [consoleHeight]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = startYRef.current - e.clientY; // dragging up → larger console
      const next = Math.max(60, Math.min(window.innerHeight * 0.6, startHeightRef.current + delta));
      setConsoleHeight(next);
    };
    const onMouseUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return (
    <div className="h-screen flex flex-col bg-bg-main overflow-hidden border border-border-main max-w-[1440px] mx-auto shadow-2xl">
      <Navbar />
      <ConfigBar
        appId={config.appId}
        authMode={config.authMode}
        jwtAvailable={jwtAvailable}
        jwtRemainingSeconds={jwtRemainingSeconds}
      />

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-[1px] bg-border-main overflow-hidden">
        {/* ASR Panel */}
        <div className="bg-white overflow-y-auto">
          <ASRDemo config={runtimeConfig} onLog={addLog} />
        </div>

        {/* TTS Panel */}
        <div className="bg-white overflow-y-auto">
          <TTSDemo config={runtimeConfig} onLog={addLog} />
        </div>
      </main>

      {/* Drag handle */}
      <div
        onMouseDown={onDragStart}
        className="h-[5px] shrink-0 bg-border-main hover:bg-primary/40 active:bg-primary/60 cursor-ns-resize transition-colors group relative"
        title="拖动调整控制台高度"
      >
        {/* center grip dots */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-6 h-[2px] rounded-full bg-primary/60" />
        </div>
      </div>

      {/* Console Area */}
      <div style={{ height: consoleHeight }} className="bg-[#1D2129] flex flex-col shrink-0">
        <div className="h-8 border-b border-white/10 flex items-center px-4 gap-2 text-white/50">
          <Terminal className="w-3.5 h-3.5" />
          <span className="text-[11px] font-bold tracking-wider uppercase">Runtime Console</span>
          <button 
            onClick={() => setShowSettings(true)}
            className="ml-auto flex items-center gap-1.5 text-[10px] bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded transition-colors"
          >
            <Settings className="w-3 h-3" />
            配置参数
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 font-mono text-[12px] leading-relaxed">
          {logs.length === 0 && (
            <div className="text-[#5F7285] italic text-[11px]">— 等待操作日志 —</div>
          )}
          {logs.map((log, i) => (
            <div key={i} className="flex gap-3 mb-1">
              <span className="text-[#5F7285] shrink-0">[{log.time}]</span>
              <span className={`shrink-0 ${log.type === 'Error' ? 'text-red-400' : log.type === 'Success' ? 'text-green-400' : 'text-blue-400'}`}>
                [{log.type}]
              </span>
              <span className="text-[#A9AEB8] break-all">{log.msg}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-md bg-white rounded-lg shadow-2xl overflow-hidden"
            >
              <div className="bg-primary px-6 py-4 flex justify-between items-center text-white">
                <h3 className="font-bold text-sm tracking-wide">服务配置参数</h3>
                <button onClick={() => setShowSettings(false)} className="hover:opacity-70">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-6 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-bold text-text-secondary uppercase">App ID</label>
                  <input
                    type="text"
                    value={config.appId}
                    onChange={(e) => setConfig({ ...config, appId: e.target.value })}
                    className="p-2.5 rounded border border-border-main outline-none focus:border-primary text-sm bg-bg-main"
                    placeholder="输入你的 Volcengine AppID"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-bold text-text-secondary uppercase">Access Token</label>
                  <input
                    type="text"
                    value={config.token}
                    onChange={(e) => setConfig({ ...config, token: e.target.value })}
                    className="p-2.5 rounded border border-border-main outline-none focus:border-primary text-sm bg-bg-main"
                    placeholder="输入 Access Token"
                  />
                </div>
                <div className="rounded border border-border-main bg-bg-main p-3 flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-bold text-[#1D2129] uppercase">方案1 JWT 测试模式</div>
                      <div className="text-[10px] text-text-secondary mt-1">
                        本地服务用长期 token 换短期 JWT，前端直连时用 query 传递 JWT。
                      </div>
                    </div>
                    <KeyRound className="w-4 h-4 text-primary shrink-0" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => updateAuthMode('access-token')}
                      className={`h-8 rounded border text-xs font-semibold transition-colors ${
                        config.authMode === 'access-token'
                          ? 'bg-primary text-white border-primary'
                          : 'bg-white text-[#4E5969] border-border-main hover:bg-gray-50'
                      }`}
                    >
                      Access Token
                    </button>
                    <button
                      type="button"
                      onClick={() => updateAuthMode('jwt-test')}
                      disabled={!config.jwtToken}
                      className={`h-8 rounded border text-xs font-semibold transition-colors disabled:opacity-50 ${
                        config.authMode === 'jwt-test'
                          ? 'bg-primary text-white border-primary'
                          : 'bg-white text-[#4E5969] border-border-main hover:bg-gray-50'
                      }`}
                    >
                      JWT 测试
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={fetchJwtToken}
                    disabled={!config.appId || !config.token || isFetchingJwt}
                    className="h-9 rounded bg-white border border-border-main text-[#1D2129] text-xs font-semibold hover:bg-gray-50 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    {isFetchingJwt ? '获取中...' : '获取 JWT Token 并启用'}
                  </button>
                  <div className="text-[10px] text-text-secondary leading-relaxed">
                    {config.jwtToken
                      ? `JWT token 已获取${jwtRemainingSeconds !== null ? `，剩余约 ${Math.ceil(jwtRemainingSeconds / 60)} 分钟` : ''}。`
                      : '尚未获取 JWT token。'}
                    {' '}JWT 只用于前端直连测试，不写入源码。
                  </div>
                </div>
                <div className="mt-2 flex flex-col gap-3">
                  <button
                    onClick={() => setShowSettings(false)}
                    className="w-full bg-primary text-white py-2.5 rounded font-bold hover:brightness-110 active:scale-[0.98] transition-all shadow-sm shadow-primary/20"
                  >
                    保存配置
                  </button>
                  <p className="text-[10px] text-text-secondary text-center leading-relaxed px-4">
                    这里只保留应用级配置。ASR 和 TTS 的测试模式选择在各自面板内切换。
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
