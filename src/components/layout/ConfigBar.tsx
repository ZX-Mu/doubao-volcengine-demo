interface ConfigBarProps {
  appId: string;
  authMode: 'access-token' | 'jwt-test';
  jwtAvailable: boolean;
  jwtRemainingSeconds: number | null;
}

export default function ConfigBar({ appId, authMode, jwtAvailable, jwtRemainingSeconds }: ConfigBarProps) {
  const authLabel = authMode === 'jwt-test' ? '方案1 JWT 测试' : '应用级 Access Token';
  const jwtStatus = jwtAvailable
    ? `JWT 剩余 ${Math.ceil((jwtRemainingSeconds ?? 0) / 60)} 分钟`
    : authMode === 'jwt-test'
      ? 'JWT 未就绪'
      : '未启用 JWT';

  return (
    <div className="h-12 bg-white border-b border-border-main flex items-center px-6 gap-6 text-[13px] overflow-x-auto whitespace-nowrap scrollbar-hide">
      <div className="flex items-center gap-2">
        <span className="text-text-secondary">AppID:</span>
        <strong className="text-[#1D2129] font-semibold">{appId || '未配置'}</strong>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-text-secondary">接入范围:</span>
        <strong className="text-[#1D2129] font-semibold">{authLabel}</strong>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-text-secondary">JWT:</span>
        <strong className="text-[#1D2129] font-semibold">{jwtStatus}</strong>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-text-secondary">采样率:</span>
        <strong className="text-[#1D2129] font-semibold">16000Hz</strong>
      </div>
    </div>
  );
}
