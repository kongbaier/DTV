// HEVC(H.265) MSE 支持探测与安装提示（WebView2 兼容性兜底）。
export const HEV1_MIME = 'video/mp4; codecs="hev1.1.6.L93.B0"';
export const HVC1_MIME = 'video/mp4; codecs="hvc1.1.6.L93.B0"';

export function supportsMseType(mime: string): boolean {
  try {
    return (
      typeof MediaSource !== 'undefined' &&
      typeof MediaSource.isTypeSupported === 'function' &&
      MediaSource.isTypeSupported(mime)
    );
  } catch {
    return false;
  }
}

export function maybeAppendHevcInstallHint(rawMessage: string): string {
  const msg = String(rawMessage || '');
  const lower = msg.toLowerCase();
  const looksLikeHevcCodecUnsupported =
    (lower.includes('video/mp4') &&
      (lower.includes('hev1') || lower.includes('hvc1'))) ||
    lower.includes('hevc') ||
    lower.includes('h.265') ||
    lower.includes('h265');
  if (!looksLikeHevcCodecUnsupported) return msg;

  const hev1Supported = supportsMseType(HEV1_MIME);
  const hvc1Supported = supportsMseType(HVC1_MIME);

  if (!hev1Supported && !hvc1Supported) {
    return `${msg}\n\n提示：检测到当前环境不支持 HEVC(H.265) 解码（hev1/hvc1 均不支持）。\n请安装 Microsoft.HEVCVideoExtension 插件后重启软件。\n下载地址：https://github.com/chen-zeong/DTV/releases\n（按 release 提示下载并安装对应插件）`;
  }

  return msg;
}
