interface ConfigBarProps {
  appId: string;
}

export default function ConfigBar({ appId }: ConfigBarProps) {
  return (
    <div className="h-12 bg-white border-b border-border-main flex items-center px-6 gap-6 text-[13px] overflow-x-auto whitespace-nowrap scrollbar-hide">
      <div className="flex items-center gap-2">
        <span className="text-text-secondary">AppID:</span>
        <strong className="text-[#1D2129] font-semibold">{appId || '未配置'}</strong>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-text-secondary">接入范围:</span>
        <strong className="text-[#1D2129] font-semibold">应用级凭证</strong>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-text-secondary">采样率:</span>
        <strong className="text-[#1D2129] font-semibold">16000Hz</strong>
      </div>
    </div>
  );
}
