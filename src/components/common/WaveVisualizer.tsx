import { useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';

interface WaveVisualizerProps {
    audioUrl?: string;
    isLive?: boolean;
    stream?: MediaStream | null;
}

export default function WaveVisualizer({ audioUrl, isLive, stream }: WaveVisualizerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const wavesurferRef = useRef<WaveSurfer | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        const wavesurfer = WaveSurfer.create({
            container: containerRef.current,
            waveColor: '#d1d5db',
            progressColor: '#165DFF',
            cursorColor: 'transparent',
            height: 60,
            barWidth: 2,
            barGap: 3,
            barRadius: 2,
        });

        wavesurferRef.current = wavesurfer;

        if (audioUrl) {
            wavesurfer.load(audioUrl);
        }

        return () => wavesurfer.destroy();
    }, [audioUrl]);

    // Live visualization is a bit more complex with wavesurfer, 
    // usually requires a plugin. For now we just show a static or loaded waveform.
    
    return (
        <div className="w-full bg-gray-50 rounded-lg p-4 border border-gray-100">
            <div ref={containerRef} />
        </div>
    );
}
