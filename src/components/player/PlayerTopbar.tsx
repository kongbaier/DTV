'use client';

type PlayerTopbarProps = {
  roomId: string;
  playerTitle: string | null;
  playerAnchorName: string | null;
  playerAvatar: string | null;
  playerIsLive: boolean | null;
  isLoadingStream: boolean;
  isFollowed: boolean;
  avatarSrc: string;
  onClose: () => void;
  onToggleFollow: () => void;
};

/** 播放页顶栏：返回按钮 + 主播信息（头像/标题/ID/直播态）+ 关注。 */
export function PlayerTopbar({
  roomId,
  playerTitle,
  playerAnchorName,
  playerAvatar,
  playerIsLive,
  isLoadingStream,
  isFollowed,
  avatarSrc,
  onClose,
  onToggleFollow,
}: PlayerTopbarProps) {
  return (
    <div className="player-topbar">
      <div className="player-topbar-left">
        <button
          type="button"
          className="player-close-btn"
          title="关闭"
          aria-label="关闭"
          onClick={onClose}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="player-topbar-streamer" title={playerTitle || roomId}>
          <div className="player-topbar-avatar">
            {playerAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarSrc} alt={playerAnchorName ?? roomId} />
            ) : (
              <div className="player-topbar-avatarFallback">
                {(playerAnchorName || roomId || 'D').charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="player-topbar-meta">
            <div className="player-topbar-title">{playerTitle || roomId}</div>
            <div className="player-topbar-sub">
              {playerAnchorName || '未知主播'} · ID:{roomId}
            </div>
          </div>
          <div
            className={`player-topbar-status ${playerIsLive === false ? 'is-offline' : 'is-live'}`}
          >
            {isLoadingStream
              ? '加载中'
              : playerIsLive === false
                ? '未开播'
                : '直播中'}
          </div>
          <button
            type="button"
            className={`player-topbar-follow ${isFollowed ? 'is-following' : ''}`}
            onClick={onToggleFollow}
          >
            {isFollowed ? '取关' : '关注'}
          </button>
        </div>
      </div>
    </div>
  );
}
