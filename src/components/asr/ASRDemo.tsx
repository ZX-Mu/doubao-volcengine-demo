import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, Square, Activity, Search } from 'lucide-react';
import { useASR, type ASRMode } from '../../hooks/useASR';
import { useASRAsync } from '../../hooks/useASRAsync';
import WaveVisualizer from '../common/WaveVisualizer';

const ASR_MODES: { label: string; value: ASRMode; resourceId: string; shortLabel: string }[] = [
    { label: '流式输入模式', value: 'nostream', resourceId: 'volc.seedasr.sauc.duration', shortLabel: '流式输入' },
    { label: '双向流式模式', value: 'bidirectional', resourceId: 'volc.bigasr.sauc.duration', shortLabel: '双向流式' },
    { label: '双向流式模式（优化版）', value: 'async', resourceId: 'volc.seedasr.sauc.duration', shortLabel: '双向流式优化版' },
];

const ASR_RESOURCE_OPTIONS = [
    { label: '豆包流式语音识别模型 1.0 小时版', value: 'volc.bigasr.sauc.duration' },
    { label: '豆包流式语音识别模型 1.0 并发版', value: 'volc.bigasr.sauc.concurrent' },
    { label: '豆包流式语音识别模型 2.0 小时版', value: 'volc.seedasr.sauc.duration' },
    { label: '豆包流式语音识别模型 2.0 并发版', value: 'volc.seedasr.sauc.concurrent' },
];

function mergeNoStreamText(previous: string, incoming: string) {
    const current = previous.trim();
    const next = incoming.trim();

    if (!current) return next;
    if (!next) return current;
    if (next.startsWith(current)) return next;
    if (current.includes(next)) return current;
    if (next.includes(current)) return next;

    const separator = current.endsWith('。') || current.endsWith('！') || current.endsWith('？') ? '' : ' ';
    return `${current}${separator}${next}`;
}

function mergeStreamingText(previous: string, incoming: string) {
    const current = previous.trim();
    const next = incoming.trim();

    if (!current) return next;
    if (!next) return current;
    if (next === current) return current;

    // Bidirectional modes are expected to return the latest whole hypothesis.
    if (next.startsWith(current) || next.includes(current)) return next;
    if (current.startsWith(next) || current.includes(next)) return current;

    return next;
}

function mergeDisplayTextByMode(mode: ASRMode, previous: string, incoming: string) {
    if (mode === 'nostream') {
        return mergeNoStreamText(previous, incoming);
    }
    return mergeStreamingText(previous, incoming);
}

export default function ASRDemo({ config, onLog }: { config: any; onLog: (type: string, msg: string) => void }) {
    const genericAsr = useASR();
    const asyncAsr = useASRAsync();
    const [mode, setMode] = useState<ASRMode>('async');
    const [resourceId, setResourceId] = useState('volc.seedasr.sauc.duration');
    const [history, setHistory] = useState<string[]>([]);
    const [displayText, setDisplayText] = useState('');
    const [isChecking, setIsChecking] = useState(false);

    const activeAsr = mode === 'async' ? asyncAsr : genericAsr;
    const { start, stop, isRecording, result, error } = activeAsr;

    // Stabilize onLog reference to prevent infinite useEffect loops
    const onLogRef = useRef(onLog);
    useEffect(() => { onLogRef.current = onLog; });
    const stableLog = useCallback((type: string, msg: string) => onLogRef.current(type, msg), []);

    useEffect(() => {
        if (!result.text || !result.receivedAt) return;
        stableLog('ASR', `${result.isFinal ? 'Final' : 'Partial'} [${result.sequence ?? '-'}]: ${JSON.stringify({ text: result.text, isFinal: result.isFinal })}`);

        setDisplayText((prev) => mergeDisplayTextByMode(mode, prev, result.text));

        if (result.isFinal) {
            setHistory((prev) => {
                const finalText = mergeDisplayTextByMode(mode, displayText, result.text);
                if (!finalText) return prev;
                if (prev[0] === finalText) return prev;
                return [finalText, ...prev];
            });
        }
    }, [displayText, mode, result, stableLog]);

    useEffect(() => {
        if (error) stableLog('Error', error);
    }, [error, stableLog]);

    useEffect(() => {
        if (!isRecording) return;
        setDisplayText('');
    }, [isRecording]);

    const selectedMode = ASR_MODES.find((item) => item.value === mode) ?? ASR_MODES[2];

    const runHandshakeCheck = useCallback(async () => {
        stableLog('Info', `Checking ASR handshake: ${selectedMode.label}...`);
        setIsChecking(true);
        try {
            const response = await fetch('/api/proxy/asr/check', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    appId: config.appId,
                    token: config.token,
                    mode,
                    resourceId,
                }),
            });
            const data = await response.json();
            if (!data?.ok) {
                stableLog('Error', `ASR 握手检查失败: ${data?.responseHead ?? data?.error ?? `HTTP ${response.status}`}${data?.responseBody ? ` | body: ${data.responseBody}` : ''}`);
                return false;
            }
            stableLog('Success', `ASR 握手检查通过: ${selectedMode.label}`);
            return true;
        } catch (err: any) {
            stableLog('Error', `ASR 握手检查异常: ${err?.message ?? '未知错误'}`);
            return false;
        } finally {
            setIsChecking(false);
        }
    }, [config.appId, config.token, mode, resourceId, selectedMode.label, stableLog]);

    const handleToggle = () => {
        if (isRecording) {
            stableLog('Info', 'ASR 2.0 session stopped by user.');
            stop();
        } else {
            void (async () => {
                const handshakeOk = await runHandshakeCheck();
                if (!handshakeOk) {
                    return;
                }

                stableLog('Info', `Starting ASR ${selectedMode.label}...`);
                start({
                    appId: config.appId,
                    token: config.token,
                    mode,
                    resourceId,
                });
            })();
        }
    };

    const handleCheck = async () => {
        await runHandshakeCheck();
    };

    const handleModeChange = (nextMode: ASRMode) => {
        const next = ASR_MODES.find((item) => item.value === nextMode) ?? ASR_MODES[0];
        setMode(nextMode);
        setResourceId(next.resourceId);
        setDisplayText('');
        setHistory([]);
    };

    return (
        <div className="h-full flex flex-col p-5 bg-white relative">
            <div className="panel-title text-base font-bold text-[#1D2129] mb-4 flex items-center gap-2">
                <Mic className="w-4 h-4 text-primary" />
                语音识别模型 2.0
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-text-secondary uppercase">识别模式</label>
                    <select
                        className="bg-bg-sub border border-border-main rounded px-2 py-2 text-xs font-medium outline-none"
                        value={mode}
                        onChange={(e) => handleModeChange(e.target.value as ASRMode)}
                    >
                        {ASR_MODES.map((item) => (
                            <option key={item.value} value={item.value}>{item.label}</option>
                        ))}
                    </select>
                </div>
                <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-text-secondary uppercase">资源 ID</label>
                    <select
                        value={resourceId}
                        onChange={(e) => setResourceId(e.target.value)}
                        className="bg-bg-sub border border-border-main rounded px-2 py-2 text-xs font-medium outline-none"
                    >
                        {ASR_RESOURCE_OPTIONS.map((item) => (
                            <option key={item.value} value={item.value}>{item.label}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="flex-1 bg-bg-sub border border-border-main rounded-lg p-5 flex flex-col gap-4 relative overflow-hidden mb-4">
                <div className="absolute top-3 right-4 flex gap-2">
                    <span className="px-2 py-0.5 bg-white/80 border border-border-main rounded text-[10px] text-text-secondary font-bold">ZH-CN</span>
                    {isRecording && (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-red-50 text-red-600 rounded border border-red-100 animate-pulse">
                            <div className="w-1.5 h-1.5 bg-red-500 rounded-full" />
                            <span className="text-[10px] font-bold uppercase">Live</span>
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto scroll-smooth pr-2">
                    {displayText && (
                        <div className="mb-4">
                            <p className="text-[#1D2129] text-base font-medium leading-relaxed bg-primary/5 rounded py-2 px-3 border-l-2 border-primary">
                                {displayText}
                            </p>
                        </div>
                    )}

                    {history.length === 0 && !displayText && (
                        <div className="h-full flex flex-col items-center justify-center text-text-secondary/40 gap-3">
                            <Activity className="w-10 h-10 stroke-[1.5]" />
                            <p className="text-xs italic">等待听写设备启动...</p>
                        </div>
                    )}

                    {history.map((item, index) => (
                        <motion.div
                            key={`${index}-${item}`}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="mb-3 p-3 rounded border text-sm leading-relaxed shadow-sm bg-white border-border-main text-[#4E5969]"
                        >
                            {item}
                        </motion.div>
                    ))}
                </div>
                
                <div className="absolute bottom-4 right-4 text-[10px] text-text-secondary flex items-center gap-2 font-mono">
                    Mode: {selectedMode.shortLabel}
                </div>
            </div>

            <div className="flex items-center gap-3">
                <button
                    onClick={handleToggle}
                    disabled={!config.appId}
                    className={`h-9 px-6 rounded font-semibold text-sm transition-all focus:ring-2 ring-primary/20 ${
                        isRecording 
                        ? 'bg-red-500 text-white hover:bg-red-600' 
                        : 'bg-primary text-white hover:brightness-110 shadow-sm shadow-primary/20'
                    } disabled:opacity-50`}
                >
                    {isRecording ? '停止识别' : '开始识别'}
                </button>
                <button
                  onClick={handleCheck}
                  disabled={!config.appId || isChecking}
                  className="h-9 px-4 rounded border border-border-main text-[#4E5969] text-sm font-medium hover:bg-bg-main transition-colors inline-flex items-center gap-2 disabled:opacity-50"
                >
                  <Search className="w-3.5 h-3.5" />
                  {isChecking ? '检查中...' : '检查握手'}
                </button>
                
                <div className="ml-auto w-32 h-8 overflow-hidden rounded bg-bg-sub border border-border-main p-1">
                   <WaveVisualizer />
                </div>
            </div>
        </div>
    );
}
