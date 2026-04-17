import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import { Play, Square, Download, MessageSquare } from 'lucide-react';
import { useTTS } from '../../hooks/useTTS';
import { useTTSWsUnidirectional } from '../../hooks/useTTSWsUnidirectional';
import { useTTSWsBidirectional } from '../../hooks/useTTSWsBidirectional';
import { TTS_MODE_IDS } from '../../utils/ttsMode';

const TTS_MODES = [
  { id: TTS_MODE_IDS.SSE_V3, name: '单向流式模式（HTTP SSE V3）', resourceId: 'seed-tts-2.0', implemented: true },
  { id: TTS_MODE_IDS.WS_UNIDIRECTIONAL_V3, name: '单向流式模式（WebSocket V3）', resourceId: 'seed-tts-2.0', implemented: true },
  { id: TTS_MODE_IDS.WS_BIDIRECTIONAL_V3, name: '双向流式模式（WebSocket V3）', resourceId: 'seed-tts-2.0', implemented: true },
];

type SpeakerOption = {
  id: string;
  name: string;
  category: string;
};

const SPEAKERS: SpeakerOption[] = [
  // 通用场景
  { id: 'zh_female_vv_uranus_bigtts', name: 'Vivi 2.0', category: '通用场景' },
  { id: 'zh_female_xiaohe_uranus_bigtts', name: '小何 2.0', category: '通用场景' },
  { id: 'zh_male_m191_uranus_bigtts', name: '云舟 2.0', category: '通用场景' },
  { id: 'zh_male_taocheng_uranus_bigtts', name: '小天 2.0', category: '通用场景' },
];

export default function TTSDemo({ config, onLog }: { config: any; onLog: (type: string, msg: string) => void }) {
    const [text, setText] = useState('今天天气可好了，我打算和朋友一起去野餐，带上美食和饮料，找个舒适的草坪，什么烦恼都没了。你要不要和我们一起呀？');
    const [ttsMode, setTtsMode] = useState(TTS_MODES[0]);
    const [resourceId, setResourceId] = useState(TTS_MODES[0].resourceId);
    const [selectedSpeaker, setSelectedSpeaker] = useState(SPEAKERS[0]);

    const sseTts = useTTS();
    const wsTts = useTTSWsUnidirectional();
    const wsBidirectionalTts = useTTSWsBidirectional();
    const stopSse = sseTts.stop;
    const stopWs = wsTts.stop;
    const stopWsBidirectional = wsBidirectionalTts.stop;
    const isWsUnidirectionalMode = ttsMode.id === TTS_MODE_IDS.WS_UNIDIRECTIONAL_V3;
    const isWsBidirectionalMode = ttsMode.id === TTS_MODE_IDS.WS_BIDIRECTIONAL_V3;
    const activeTts = isWsBidirectionalMode ? wsBidirectionalTts : isWsUnidirectionalMode ? wsTts : sseTts;
    const { speak, stop, isPlaying, error, audioUrl, fileName, chunkCount, audioByteLength } = activeTts;
    const onLogRef = useRef(onLog);
    useEffect(() => { onLogRef.current = onLog; });
    const stableLog = useCallback((type: string, msg: string) => onLogRef.current(type, msg), []);
    const lastChunkCountRef = useRef(0);

    useEffect(() => () => {
        stopSse();
        stopWs();
        stopWsBidirectional();
    }, [stopSse, stopWs, stopWsBidirectional]);

    useEffect(() => {
        if (error) stableLog('Error', error);
    }, [error, stableLog]);

    useEffect(() => {
        if (chunkCount > 0 && chunkCount !== lastChunkCountRef.current) {
            lastChunkCountRef.current = chunkCount;
            stableLog('TTS', `${isWsBidirectionalMode ? 'WS-BIDI' : isWsUnidirectionalMode ? 'WS' : 'SSE'} audio chunks received: ${chunkCount}`);
        }
    }, [chunkCount, isWsBidirectionalMode, isWsUnidirectionalMode, stableLog]);

    useEffect(() => {
        if (audioByteLength > 0) {
            stableLog('TTS', `Merged audio bytes: ${audioByteLength}`);
        }
    }, [audioByteLength, stableLog]);

    useEffect(() => {
        if (audioUrl) {
            stableLog('Success', 'TTS 音频流接收完成');
        }
    }, [audioUrl, stableLog]);

    const handleSpeak = () => {
        if (!ttsMode.implemented) {
            stableLog('Error', `${ttsMode.name} 尚未按官方文档校对完成，当前只支持 HTTP SSE 单向流式-V3`);
            return;
        }

        if (isPlaying) {
            stableLog('Info', 'TTS playback stopped.');
            stop();
        } else {
            stopSse();
            stopWs();
            stopWsBidirectional();
            lastChunkCountRef.current = 0;
            stableLog('TTS', `[${isWsBidirectionalMode ? 'WS-BIDI-V3' : isWsUnidirectionalMode ? 'WS-V3' : 'SSE-V3'}] Requesting ${ttsMode.name} for ${text.length} characters...`);
            speak(text, {
                appId: config.appId,
                token: config.token,
                resourceId,
                voiceType: selectedSpeaker.id,
                speechRate: 0,
                pitchRate: 0,
                loudnessRate: 0
            });
        }
    };

    return (
        <div className="h-full flex flex-col p-5 bg-white border-l border-border-main">
            <div className="panel-title text-base font-bold text-[#1D2129] mb-4 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary" />
                豆包语音合成大模型 2.0
            </div>

            <textarea
                className="flex-1 w-full bg-white border border-border-main rounded-lg p-4 text-sm text-[#4E5969] leading-relaxed resize-none focus:border-primary outline-none transition-all mb-4"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="请输入需要合成的文本..."
            />

            <div className="flex flex-col gap-5">
                <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-text-secondary uppercase">合成模式</label>
                        <select
                            className="bg-bg-sub border border-border-main rounded px-2 py-1.5 text-xs font-medium outline-none"
                            value={ttsMode.id}
                            onChange={(e) => {
                                const next = TTS_MODES.find((item) => item.id === e.target.value) ?? TTS_MODES[0];
                                stopSse();
                                stopWs();
                                stopWsBidirectional();
                                lastChunkCountRef.current = 0;
                                setTtsMode(next);
                                setResourceId(next.resourceId);
                            }}
                        >
                            {TTS_MODES.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {item.implemented ? item.name : `${item.name}（待实现）`}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-text-secondary uppercase">资源 ID</label>
                        <div className="bg-bg-sub border border-border-main rounded px-2 py-1.5 text-xs font-medium text-[#4E5969]">
                            {resourceId}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-3">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-text-secondary uppercase">音色设置</label>
                        <select 
                            className="bg-bg-sub border border-border-main rounded px-2 py-1.5 text-xs font-medium outline-none"
                            value={selectedSpeaker.id}
                            onChange={(e) => setSelectedSpeaker(SPEAKERS.find(s => s.id === e.target.value) || SPEAKERS[0])}
                        >
                            {Array.from(new Set(SPEAKERS.map(s => s.category))).map(category => (
                                <optgroup key={category} label={category}>
                                    {SPEAKERS.filter(s => s.category === category).map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                        <p className="text-[10px] text-text-secondary">
                            当前仅展示最新官方文档中 `seed-tts-2.0` 对应的 4 个 2.0 音色。
                        </p>
                    </div>
                </div>

                <div className="bg-bg-sub rounded-lg p-3 flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleSpeak}
                            disabled={!config.appId}
                            className={`h-9 px-6 rounded font-semibold text-sm transition-all flex items-center gap-2 ${
                                isPlaying 
                                ? 'bg-red-500 text-white hover:bg-red-600' 
                                : 'bg-primary text-white hover:brightness-110 shadow-sm'
                            } disabled:opacity-50`}
                        >
                            {isPlaying ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                            {isPlaying ? '停止' : '立即开始合成'}
                        </button>
                        <a
                            href={audioUrl ?? undefined}
                            download={fileName}
                            className={`h-9 px-4 rounded border border-border-main text-xs font-medium bg-white transition-colors inline-flex items-center gap-2 ${
                                audioUrl ? 'text-[#4E5969] hover:bg-gray-50' : 'text-[#C9CDD4] pointer-events-none'
                            }`}
                        >
                            <Download className="w-3.5 h-3.5" />
                            下载音频
                        </a>
                    </div>

                    <div className="flex items-center gap-4 py-1">
                        <button className="w-8 h-8 rounded-full bg-white border border-border-main flex items-center justify-center text-primary shadow-sm">
                             {isPlaying ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current ml-0.5" />}
                        </button>
                        <div className="flex-1 h-1 bg-[#D1D5DB] rounded-full relative overflow-hidden">
                            <motion.div 
                                animate={isPlaying ? { width: ['0%', '100%'] } : { width: '0%' }}
                                transition={isPlaying ? { duration: 5, repeat: Infinity } : {}}
                                className="absolute inset-y-0 left-0 bg-primary"
                            />
                        </div>
                        <span className="text-[10px] font-mono text-text-secondary">
                            {chunkCount > 0 ? `${chunkCount} chunks` : 'waiting'}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
