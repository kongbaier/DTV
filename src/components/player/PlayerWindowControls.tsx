'use client';

type PlayerWindowControlsProps = {
  isWindows: boolean;
  isMaximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
};

/** 播放页右上角窗口控制（最小化 / 最大化⇄还原 / 关闭），仅 Windows 风格 chrome 显示。 */
export function PlayerWindowControls({
  isWindows,
  isMaximized,
  onMinimize,
  onToggleMaximize,
  onClose,
}: PlayerWindowControlsProps) {
  if (!isWindows) {
    return null;
  }
  return (
    <div
      className="player-window-controls"
      data-player-drag="false"
      aria-label="窗口控制"
    >
      <button
        type="button"
        className="window-btn"
        data-player-drag="false"
        aria-label="最小化"
        onClick={() => void onMinimize()}
      >
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M6 12h12"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="window-btn"
        data-player-drag="false"
        aria-label={isMaximized ? '还原' : '最大化'}
        onClick={() => void onToggleMaximize()}
      >
        {!isMaximized ? (
          <svg viewBox="0 0 24 24" fill="none">
            <rect
              x="6.5"
              y="6.5"
              width="11"
              height="11"
              rx="1.6"
              stroke="currentColor"
              strokeWidth="1.8"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M9 7.5h8a2 2 0 0 1 2 2v8"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <rect
              x="5.5"
              y="9.5"
              width="11"
              height="11"
              rx="1.6"
              stroke="currentColor"
              strokeWidth="1.8"
            />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="window-btn window-btn--close"
        data-player-drag="false"
        aria-label="关闭软件"
        onClick={() => void onClose()}
      >
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M7 7l10 10"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M17 7L7 17"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
