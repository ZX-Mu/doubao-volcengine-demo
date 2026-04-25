export type AuthMode = 'access-token' | 'jwt-test';

export interface SpeechConfig {
  appId: string;
  token: string;
  authMode: AuthMode;
  jwtToken: string;
  jwtExpiresAt: number | null;
}

export function buildSpeechCredential(config: Pick<SpeechConfig, 'token' | 'authMode' | 'jwtToken'>) {
  if (config.authMode === 'jwt-test') {
    return config.jwtToken ? `Jwt; ${config.jwtToken}` : '';
  }

  return config.token;
}

export function getJwtRemainingSeconds(expiresAt: number | null, now = Date.now()) {
  if (!expiresAt) return null;
  return Math.max(0, Math.floor((expiresAt - now) / 1000));
}

export function redactSpeechUrl(url: string) {
  return url
    .replace(/([?&]api_access_key=)[^&]+/g, '$1***')
    .replace(/([?&]token=)[^&]+/g, '$1***')
    .replace(/(X-Api-Access-Key=)[^&]+/g, '$1***');
}
