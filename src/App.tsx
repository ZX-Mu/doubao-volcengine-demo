/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback, type MouseEvent } from 'react';
import Navbar from './components/layout/Navbar';
import ConfigBar from './components/layout/ConfigBar';
import TTSDemo from './components/tts/TTSDemo';
import ASRDemo from './components/asr/ASRDemo';
import { Settings, X, Terminal } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Config {
  appId: string;
  token: string;
}

const DEFAULT_CONFIG: Config = {
  appId: '',
  token: '',
};

export default function App() {
  const [config, setConfig] = useState<Config>(() => {
    const saved = localStorage.getItem('volengine_demo_config');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_CONFIG, ...parsed };
    }
    return DEFAULT_CONFIG;
  });
  const [showSettings, setShowSettings] = useState(!config.appId);
  const [logs, setLogs] = useState<{ time: string; type: string; msg: string }[]>([]);

  useEffect(() => {
    localStorage.setItem('volengine_demo_config', JSON.stringify(config));
  }, [config]);

  const addLog = (type: string, msg: string) => {
    const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setLogs(prev => [{ time: now, type, msg }, ...prev].slice(0, 50));
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
      <ConfigBar appId={config.appId} />

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-[1px] bg-border-main overflow-hidden">
        {/* ASR Panel */}
        <div className="bg-white overflow-y-auto">
          <ASRDemo config={config} onLog={addLog} />
        </div>

        {/* TTS Panel */}
        <div className="bg-white overflow-y-auto">
          <TTSDemo config={config} onLog={addLog} />
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
                    type="password"
                    value={config.token}
                    onChange={(e) => setConfig({ ...config, token: e.target.value })}
                    className="p-2.5 rounded border border-border-main outline-none focus:border-primary text-sm bg-bg-main"
                    placeholder="输入 Access Token"
                  />
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
