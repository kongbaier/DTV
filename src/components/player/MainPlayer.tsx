'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import 'xgplayer/dist/index.min.css';
import './player.css';

import { Platform } from '@/platforms/common/types';
import { useImageProxy } from '@/hooks/useImageProxy';
import { useWindowDrag } from '@/hooks/useWindowDrag';
import { useWindowState } from '@/hooks/useWindowState';
import {
  useFollow,
  type FollowedStreamer,
  type Platform as FollowPlatform,
} from '@/state/follow/FollowProvider';
import { usePlayerUi } from '@/state/playerUi/PlayerUiProvider';
import {
  PLAYER_DRAG_EXCLUDED_SELECTOR,
  usePlayerChrome,
} from '@/components/player/usePlayerChrome';
import { useDanmuPreferences } from '@/components/player/useDanmuPreferences';
import { usePlayerEngine } from '@/components/player/usePlayerEngine';
import { PlayerStateOverlay } from '@/components/player/PlayerStateOverlay';
import { PlayerTopbar } from '@/components/player/PlayerTopbar';
import { PlayerWindowControls } from '@/components/player/PlayerWindowControls';

function toFollowPlatform(platform: Platform): FollowPlatform {
  if (platform === Platform.DOUYU) return 'DOUYU';
  if (platform === Platform.DOUYIN) return 'DOUYIN';
  if (platform === Platform.HUYA) return 'HUYA';
  return 'BILIBILI';
}

/**
 * 播放页组合根：只做组装与跨域粘合 ——
 * 整页拖拽/chrome 自动隐藏（usePlayerChrome + useWindowDrag）、弹幕偏好（useDanmuPreferences）、
 * 播放器引擎生命周期（usePlayerEngine）、窗口/全屏协调（useWindowState）、关注（useFollow）、
 * island 元数据同步。具体职责见被拆出的各模块。
 */
export function MainPlayer({
  platform,
  roomId,
  onRequestClose,
}: {
  platform: Platform;
  roomId: string;
  onRequestClose?: () => void;
}) {
  const navigate = useNavigate();
  const follow = useFollow();
  const { setIsland, clearIsland } = usePlayerUi();
  const { ensureProxyStarted, getAvatarSrc } = useImageProxy();
  const {
    isWindows,
    isMaximized,
    toggleMaximizeWindow,
    minimizeWindow,
    closeWindow,
  } = useWindowState();

  // 整页窗口拖拽：就近挂载 useWindowDrag，用独立的 data-player-drag 标记把播放页从
  // chrome 的 data-drag-region（带双击最大化）中切出去。播放页的双击语义交给 xgplayer
  // （视频双击=全屏），故 doubleClick:false；xgplayer 内部控件/弹层打不了属性，
  // 只能经 PLAYER_DRAG_EXCLUDED_SELECTOR 排除。threshold 沿用旧自研逻辑的 6px。
  useWindowDrag('player-drag', {
    doubleClick: false,
    threshold: 6,
    exclude: PLAYER_DRAG_EXCLUDED_SELECTOR,
  });
  const { pageRef, chromeHiddenClass } = usePlayerChrome();

  const danmu = useDanmuPreferences();
  const engine = usePlayerEngine({
    platform,
    roomId,
    ensureProxyStarted,
    danmu,
  });
  const {
    playerContainerRef,
    playerRef,
    isLoadingStream,
    streamError,
    isOfflineError,
    playerTitle,
    playerAnchorName,
    playerAvatar,
    playerIsLive,
    reloadStream,
  } = engine;

  // 最大化/还原可能涉及与全屏互斥的切换（全屏→最大化先退全屏、还原时若先前是从全屏切来的
  // 则回到全屏），这类操作需要操作 xgplayer 元素全屏，故把当前 player 作为 peer 交给单例
  // store 的动作；其余窗口动作（minimize/close/isWindows 等）直接由 useWindowState() 提供。
  const toggleMaximizeWithPlayer = useCallback(() => {
    const player = playerRef.current;
    void toggleMaximizeWindow(
      player && typeof player.exitFullscreen === 'function'
        ? {
            exitFullscreen: () => player.exitFullscreen(),
            getFullscreen: () => player.getFullscreen(),
          }
        : undefined,
    );
  }, [toggleMaximizeWindow, playerRef]);

  useEffect(() => {
    setIsland({
      platform,
      roomId,
      anchorName: playerAnchorName,
      title: playerTitle,
      avatarUrl: getAvatarSrc(platform, playerAvatar),
    });
    return () => clearIsland();
  }, [
    clearIsland,
    getAvatarSrc,
    platform,
    playerAnchorName,
    playerAvatar,
    playerTitle,
    roomId,
    setIsland,
  ]);

  const isFollowed = useMemo(() => {
    const fp = toFollowPlatform(platform);
    return follow.isFollowed(fp, roomId);
  }, [follow, platform, roomId]);

  const followPayload = useMemo<FollowedStreamer>(() => {
    const fp = toFollowPlatform(platform);
    return {
      id: roomId,
      platform: fp,
      nickname: playerAnchorName || roomId,
      avatarUrl: playerAvatar || '',
      roomTitle: playerTitle || '',
      currentRoomId: roomId,
      liveStatus: 'UNKNOWN',
    };
  }, [platform, playerAnchorName, playerAvatar, playerTitle, roomId]);

  return (
    <div
      className={`player-page${chromeHiddenClass}`}
      ref={pageRef}
      data-player-drag
    >
      <PlayerWindowControls
        isWindows={isWindows}
        isMaximized={isMaximized}
        onMinimize={() => void minimizeWindow()}
        onToggleMaximize={() => void toggleMaximizeWithPlayer()}
        onClose={() => void closeWindow()}
      />

      <div className="player-layout">
        <div className="main-content">
          <div className="player-container player-container--solo">
            <div className="video-container">
              <PlayerTopbar
                roomId={roomId}
                playerTitle={playerTitle}
                playerAnchorName={playerAnchorName}
                playerAvatar={playerAvatar}
                playerIsLive={playerIsLive}
                isLoadingStream={isLoadingStream}
                isFollowed={isFollowed}
                avatarSrc={getAvatarSrc(platform, playerAvatar)}
                onClose={() => {
                  if (onRequestClose) onRequestClose();
                  else navigate(-1);
                }}
                onToggleFollow={() => {
                  if (isFollowed)
                    follow.unfollowStreamer(
                      followPayload.platform,
                      followPayload.id,
                    );
                  else follow.followStreamer(followPayload);
                }}
              />

              <div ref={playerContainerRef} className="video-player" />

              <PlayerStateOverlay
                isLoadingStream={isLoadingStream}
                streamError={streamError}
                isOfflineError={isOfflineError}
                onRetry={() => void reloadStream('refresh')}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
