'use client';

type PlayerStateOverlayProps = {
  isLoadingStream: boolean;
  streamError: string | null;
  isOfflineError: boolean;
  onRetry: () => void;
};

/** 播放面加载中指示 + 加载失败 / 主播未开播遮罩（含“再试一次”）。 */
export function PlayerStateOverlay({
  isLoadingStream,
  streamError,
  isOfflineError,
  onRetry,
}: PlayerStateOverlayProps) {
  return (
    <>
      {isLoadingStream ? <div className="loading-player" /> : null}
      {streamError ? (
        <div
          className={isOfflineError ? 'offline-player' : 'error-player'}
        >
          <div className="p-[18px] w-[min(520px,92vw)] mx-auto text-left">
            <div className="text-[14px] font-extrabold mb-[10px]">
              {isOfflineError ? '主播未开播' : '加载失败'}
            </div>
            <div className="text-muted-foreground font-semibold whitespace-pre-wrap">
              {streamError}
            </div>
            <div className="flex gap-[10px] mt-[14px] justify-start">
              <button className="retry-btn" onClick={onRetry}>
                再试一次
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
