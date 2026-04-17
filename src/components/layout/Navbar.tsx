import { motion } from 'motion/react';
import { Mic, MicOff, MessageSquareText, Layers, ShieldCheck, Activity } from 'lucide-react';

export default function Navbar() {
  return (
    <nav className="h-[60px] bg-white border-b border-border-main flex items-center px-6 justify-between sticky top-0 z-50">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center text-white font-bold text-lg shadow-sm">
          D
        </div>
        <span className="font-semibold text-[#1D2129] text-base tracking-tight">
          豆包语音服务交互测试
        </span>
      </div>
      
      
    </nav>
  );
}
