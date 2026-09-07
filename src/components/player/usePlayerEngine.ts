'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { listen, type Event as TauriEvent } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { v4 as uuidv4 } from 'uuid';
import { POSITIONS } from 'xgplayer/es/plugin/plugin.js';
import { IPlayerOptions } from 'xgplayer';

import type {
  DanmakuMessage,
  DanmuOverlayInstance,
  RustGetStreamUrlPayload,
} from '@/components/player/types';
import {
  applyDanmuFontFamilyForOS,
  ICONS,
  loadStoredVolumeState,
  persistDanmuKeywordBlockPreferences,
  persistDanmuPreferences,
  sanitizeDanmuArea,
  sanitizeDanmuOpacity,
  type DanmuKeywordBlockPreferences,
  type DanmuUserSettings,
} from '@/components/player/constants';
import { arrangeControlClusters } from '@/components/player/controlLayout';
import {
  DEFAULT_QUALITY,
  persistQualityPreference,
  QUALITY_OPTIONS,
  resolveStoredQuality,
} from '@/components/player/qualityOptions';
import {
  HEV1_MIME,
  HVC1_MIME,
  maybeAppendHevcInstallHint,
  supportsMseType,
} from '@/components/player/hevcSupport';
import {
  getLineLabel,
  getLineOptionsForPlatform,
  persistLinePreference,
  resolveCurrentLineFor,
  resolveStoredLine,
} from '@/components/player/lineOptions';
import { useWindowState } from '@/hooks/useWindowState';
import { usePlayerUi } from '@/state/playerUi/PlayerUiProvider';
import { Platform } from '@/platforms/common/types';
import {
  getDouyuStreamConfig,
  stopDouyuProxy,
} from '@/platforms/douyu/playerHelper';
import { stopHuyaProxy } from '@/platforms/huya/playerHelper';
import { fetchAndPrepareDouyinStreamConfig } from '@/platforms/douyin/playerHelper';
import { getHuyaStreamConfig } from '@/platforms/huya/playerHelper';
import { getBilibiliStreamConfig } from '@/platforms/bilibili/playerHelper';
import type { LineOption } from '@/components/player/plugins';
import type { DanmuPreferences } from '@/components/player/useDanmuPreferences';

declare global {
  // Used to guard against React StrictMode(dev) mount/unmount cycles accidentally stopping a newer player session.
  // eslint-disable-next-line no-var
  var __DTV_PLAYER_MOUNT_GEN: number | undefined;
}

type UnifiedRustDanmakuPayload = {
  room_id?: string;
  user: string;
  content: string;
  user_level: number;
  fans_club_level: number;
};

export type PlayerEngineParams = {
  platform: Platform;
  roomId: string;
  ensureProxyStarted: () => Promise<void>;
  danmu: DanmuPreferences;
};

export type PlayerEngine = {
  playerContainerRef: RefObject<HTMLDivElement | null>;
  playerRef: RefObject<any | null>;
  isLoadingStream: boolean;
  streamError: string | null;
  isOfflineError: boolean;
  playerTitle: string | null;
  playerAnchorName: string | null;
  playerAvatar: string | null;
  playerIsLive: boolean | null;
  reloadStream: (
    trigger: 'refresh' | 'quality' | 'line',
    overrides?: { quality?: string; line?: string | null },
  ) => Promise<void>;
};

/**
 * 播放器引擎：xgplayer 实例生命周期 + session/StrictMode 守卫 + 弹幕后端生命周期 +
 * 四平台流加载与软切换。弹幕偏好（开关/设置/关键词）由外部 useDanmuPreferences 注入。
 */
export function usePlayerEngine(params: PlayerEngineParams): PlayerEngine {
  const { platform, roomId, ensureProxyStarted, danmu } = params;
  const {
    isDanmuEnabled,
    danmuSettings,
    danmuKeywordBlock,
    setIsDanmuEnabled,
    setDanmuSettings,
    setDanmuKeywordBlock,
  } = danmu;

  const { prepareEnterFullscreen, clearEnterFullscreenRecord } =
    useWindowState();
  const { setFullscreen } = usePlayerUi();

  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const playbackKindRef = useRef<null | 'hls' | 'flv'>(null);
  const danmuOverlayRef = useRef<DanmuOverlayInstance | null>(null);
  const unlistenRef = useRef<null | (() => void)>(null);

  const disposedRef = useRef(false);
  const activeSessionIdRef = useRef(0);
  const sessionSeqRef = useRef(0);
  const mountGenRef = useRef(0);

  const refreshPluginRef = useRef<any>(null);
  const volumePluginRef = useRef<any>(null);
  const danmuTogglePluginRef = useRef<any>(null);
  const danmuSettingsPluginRef = useRef<any>(null);
  const danmuKeywordBlockPluginRef = useRef<any>(null);
  const qualityPluginRef = useRef<any>(null);
  const linePluginRef = useRef<any>(null);
  const hevcBrandPatchedRef = useRef(false);

  const [isLoadingStream, setIsLoadingStream] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isOfflineError, setIsOfflineError] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);

  const [playerTitle, setPlayerTitle] = useState<string | null>(null);
  const [playerAnchorName, setPlayerAnchorName] = useState<string | null>(null);
  const [playerAvatar, setPlayerAvatar] = useState<string | null>(null);
  const [playerIsLive, setPlayerIsLive] = useState<boolean | null>(null);

  const lineOptions: LineOption[] = useMemo(
    () => getLineOptionsForPlatform(platform),
    [platform],
  );
  const [currentQuality, setCurrentQuality] = useState<string>(() =>
    typeof window === 'undefined'
      ? DEFAULT_QUALITY
      : resolveStoredQuality(platform),
  );
  const [currentLine, setCurrentLine] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : resolveStoredLine(platform),
  );
  const currentQualityRef = useRef(currentQuality);
  const currentLineRef = useRef(currentLine);
  const lineOptionsRef = useRef<LineOption[]>(lineOptions);
  currentQualityRef.current = currentQuality;
  currentLineRef.current = currentLine;
  lineOptionsRef.current = lineOptions;

  // 关键词屏蔽偏好与关键词小写缓存的 ref 镜像（供插件 getPreferences / 弹幕监听过滤读取）。
  const danmuKeywordBlockPrefsRef =
    useRef<DanmuKeywordBlockPreferences>(danmuKeywordBlock);
  useEffect(() => {
    danmuKeywordBlockPrefsRef.current = danmuKeywordBlock;
  }, [danmuKeywordBlock]);

  const danmuKeywordBlockRef = useRef<{ keywordsLower: string[] }>({
    keywordsLower: [],
  });
  useEffect(() => {
    danmuKeywordBlockRef.current = {
      keywordsLower: (danmuKeywordBlock.keywords ?? [])
        .map((k) =>
          String(k || '')
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    };
  }, [danmuKeywordBlock.keywords]);

  useEffect(() => {
    if (platform === Platform.BILIBILI || platform === Platform.HUYA) {
      void ensureProxyStarted();
    }
  }, [ensureProxyStarted, platform]);

  useEffect(() => {
    setFullscreen(isFullScreen);
    return () => setFullscreen(false);
  }, [isFullScreen, setFullscreen]);

  const destroyPlayer = useCallback(() => {
    try {
      unlistenRef.current?.();
    } catch {
      // ignore
    }
    unlistenRef.current = null;

    try {
      danmuOverlayRef.current?.clear?.();
      danmuOverlayRef.current?.stop?.();
    } catch {
      // ignore
    }
    danmuOverlayRef.current = null;

    try {
      playerRef.current?.destroy();
    } catch {
      // ignore
    }
    playerRef.current = null;
    playbackKindRef.current = null;

    refreshPluginRef.current = null;
    volumePluginRef.current = null;
    danmuTogglePluginRef.current = null;
    danmuSettingsPluginRef.current = null;
    qualityPluginRef.current = null;
    linePluginRef.current = null;

    setIsFullScreen(false);
  }, []);

  const stopAllDanmakuBackends = useCallback(async () => {
    // Business rule: only one room at a time. Stopping all backends is the safest way to avoid cross-platform leaks.
    try {
      await invoke('stop_danmaku_listener', { roomId: '' });
    } catch {
      // ignore
    }
    try {
      await invoke('stop_douyin_danmu_listener');
    } catch {
      // ignore
    }
    try {
      await invoke('stop_huya_danmaku_listener', { roomId: '' });
    } catch {
      // ignore
    }
    try {
      await invoke('stop_bilibili_danmaku_listener');
    } catch {
      // ignore
    }
  }, []);

  const stopAllProxies = useCallback(async () => {
    // Only one room at a time; stop both to avoid "switch platform" leaks.
    try {
      await stopDouyuProxy();
    } catch {
      // ignore
    }
    try {
      await stopHuyaProxy();
    } catch {
      // ignore
    }
  }, []);

  const reloadStreamRef = useRef<
    | null
    | ((
        trigger: 'refresh' | 'quality' | 'line',
        overrides?: { quality?: string; line?: string | null },
      ) => Promise<void>)
  >(null);
  const qualityReloadArmedRef = useRef(false);
  const reloadInFlightRef = useRef(false);
  const pendingReloadRef = useRef<null | {
    trigger: 'refresh' | 'quality' | 'line';
    overrides?: { quality?: string; line?: string | null };
  }>(null);

  const isSessionActive = useCallback((sessionId: number) => {
    return !disposedRef.current && activeSessionIdRef.current === sessionId;
  }, []);

  const startDanmaku = useCallback(
    async (
      sessionId: number,
      overlay: DanmuOverlayInstance | null,
      platformToStart: Platform,
      roomIdToStart: string,
      roomIdToFilter?: string,
    ) => {
      try {
        unlistenRef.current?.();
      } catch {
        // ignore
      }
      unlistenRef.current = null;

      if (!roomIdToStart) return;
      if (!isSessionActive(sessionId)) return;

      try {
        try {
          overlay?.clear?.();
        } catch {
          // ignore
        }
        // Always stop existing backends first (cross-platform), then start the current one.
        await stopAllDanmakuBackends();
        if (!isSessionActive(sessionId)) return;

        if (platformToStart === Platform.DOUYU) {
          await invoke('start_danmaku_listener', { roomId: roomIdToStart });
        } else if (platformToStart === Platform.DOUYIN) {
          const payload: RustGetStreamUrlPayload = {
            args: { room_id_str: roomIdToStart },
            platform: Platform.DOUYIN,
          };
          await invoke('start_douyin_danmu_listener', { payload });
        } else if (platformToStart === Platform.HUYA) {
          await invoke('start_huya_danmaku_listener', {
            payload: { args: { room_id_str: roomIdToStart } },
          });
        } else if (platformToStart === Platform.BILIBILI) {
          const cookie =
            typeof localStorage !== 'undefined'
              ? localStorage.getItem('bilibili_cookie')
              : null;
          await invoke('start_bilibili_danmaku_listener', {
            payload: { args: { room_id_str: roomIdToStart } },
            cookie: cookie || null,
          });
        }
      } catch (e) {
        console.warn('[Player] start danmaku backend failed:', e);
        return;
      }

      const effectiveFilterRoomId = roomIdToFilter || roomIdToStart;
      const unlisten = await listen<UnifiedRustDanmakuPayload>(
        'danmaku-message',
        (event: TauriEvent<UnifiedRustDanmakuPayload>) => {
          if (!isSessionActive(sessionId)) return;
          const p = event.payload;
          if (!p) return;
          if (p.room_id && p.room_id !== effectiveFilterRoomId) return;

          const msg: DanmakuMessage = {
            id: uuidv4(),
            nickname: p.user || '未知用户',
            content: p.content || '',
            level: String(p.user_level || 0),
            badgeLevel:
              p.fans_club_level > 0 ? String(p.fans_club_level) : undefined,
            room_id: p.room_id || effectiveFilterRoomId,
          };

          const contentLower = (msg.content || '').toLowerCase();
          const block = danmuKeywordBlockRef.current;
          if (block.keywordsLower.length > 0) {
            for (const kw of block.keywordsLower) {
              if (kw && contentLower.includes(kw)) {
                return;
              }
            }
          }

          if (isDanmuEnabled && overlay?.sendComment) {
            try {
              overlay.sendComment({
                id: msg.id,
                txt: msg.content,
                duration: 12000,
                mode: 'scroll',
                style: {
                  color: msg.color || '#FFFFFF',
                },
              });
            } catch {
              // ignore
            }
          }
        },
      );

      unlistenRef.current = unlisten;
    },
    [isDanmuEnabled, isSessionActive, stopAllDanmakuBackends],
  );

  const mountPlayer = useCallback(
    async (
      sessionId: number,
      url: string,
      streamType: string | undefined,
      danmakuBackendRoomIdOverride?: string | null,
      danmakuFilterRoomIdOverride?: string | null,
    ) => {
      if (!isSessionActive(sessionId)) return;
      // 等待 DOM 渲染完成，确保 ref 可用
      let attempts = 0;
      while (!playerContainerRef.current && attempts < 10) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        attempts++;
      }

      if (!playerContainerRef.current) {
        console.error(
          '[Player] Player container ref is not available after waiting',
        );
        throw new Error('播放器容器初始化失败，请刷新页面重试。');
      }
      if (!isSessionActive(sessionId)) return;

      const isHlsPlayback =
        (streamType || '').toLowerCase() === 'hls' ||
        url.toLowerCase().includes('.m3u8');

      const [{ default: PlayerCtor }, flvMod, hlsMod, overlayMod, pluginsMod] =
        await Promise.all([
          import('xgplayer'),
          import('xgplayer-flv'),
          import('xgplayer-hls.js'),
          import('@/components/player/danmuOverlay'),
          import('@/components/player/plugins'),
        ]);

      const FlvPlugin = flvMod.default ?? flvMod;
      const HlsPlugin = hlsMod.default ?? hlsMod;
      const {
        applyDanmuOverlayPreferences,
        createDanmuOverlay,
        syncDanmuEnabledState,
      } = overlayMod;
      const {
        DanmuKeywordBlockControl,
        DanmuSettingsControl,
        DanmuToggleControl,
        LineControl,
        QualityControl,
        RefreshControl,
        VolumeControl,
      } = pluginsMod;

      // volume 与 muted 是两个独立轴:volume=0 不代表 muted。音量数值必须写进
      // options.volume(xgplayer 会在 start() 的异步 _startInit 里回放 config.volume,
      // 若 options 里不是持久化的数值会被默认 0.6 覆盖),muted 则由构造后同步。
      const { volume: storedPlayerVolume, muted: storedPlayerMuted } =
        loadStoredVolumeState();
      const initVolume = storedPlayerVolume ?? 0.5;
      const initMuted = storedPlayerMuted;

      const playerOptions: IPlayerOptions = {
        el: playerContainerRef.current,
        url,
        autoplay: true,
        isLive: true,
        playsinline: true,
        lang: 'zh-cn',
        videoFillMode: 'contain',
        closeVideoClick: true,
        closeVideoTouch: true,
        keyShortcut: true,
        volume: initVolume,
        width: '100%',
        height: '100%',
        pip: {
          position: POSITIONS.CONTROLS_RIGHT,
          index: 3,
          showIcon: true,
        },
        cssFullscreen: {
          index: 2,
        },
        playbackRate: false,
        controls: {
          mode: 'normal',
        },
        ignores: ['volume', 'start', 'replay', 'progress', 'time'],
        icons: {
          play: ICONS.play,
          pause: ICONS.pause,
          fullscreen: ICONS.maximize2,
          exitFullscreen: ICONS.minimize2,
          cssFullscreen: ICONS.fullscreen,
          exitCssFullscreen: ICONS.minimize2,
          pipIcon: ICONS.pictureInPicture2,
          pipIconExit: ICONS.pictureInPicture2,
        },
      };

      if (isHlsPlayback) {
        const hlsFetchOptions: RequestInit = {
          referrer: 'https://live.bilibili.com/',
          referrerPolicy: 'no-referrer-when-downgrade',
          credentials: 'omit',
          mode: 'cors',
        };

        playerOptions.plugins = [HlsPlugin];
        playerOptions.useHlsPlugin = true;
        playerOptions.hls = {
          isLive: true,
          retryCount: 3,
          retryDelay: 2000,
          enableWorker: true,
          withCredentials: false,
          lowLatencyMode: false,
          fetchOptions: hlsFetchOptions,
          xhrSetup: (xhr: XMLHttpRequest) => {
            try {
              xhr.withCredentials = false;
              xhr.setRequestHeader('Referer', 'https://live.bilibili.com/');
              xhr.setRequestHeader('Origin', 'https://live.bilibili.com');
            } catch {
              // ignore
            }
          },
        };
      } else {
        // 弱网/兼容性兜底：部分 WebView2 环境对 `hev1` codec 字符串不支持，但对 `hvc1` 支持。
        // xgplayer-transmuxer 默认会生成 `hev1.*`，这里在运行时探测后做一次 monkey patch。
        if (
          !hevcBrandPatchedRef.current &&
          !supportsMseType(HEV1_MIME) &&
          supportsMseType(HVC1_MIME)
        ) {
          try {
            const mod: any =
              await import('xgplayer-transmuxer/es/codec/hevc.js');
            const HEVC: any = mod?.HEVC;
            const orig = HEVC?.parseHEVCDecoderConfigurationRecord;
            if (HEVC && typeof orig === 'function') {
              HEVC.parseHEVCDecoderConfigurationRecord = function (
                data: any,
                hvcC?: any,
              ) {
                const ret = orig.call(this, data, hvcC);
                if (
                  ret &&
                  typeof ret.codec === 'string' &&
                  ret.codec.startsWith('hev1')
                ) {
                  ret.codec = `hvc1${ret.codec.slice(4)}`;
                }
                return ret;
              };
              hevcBrandPatchedRef.current = true;
              console.info(
                '[Player] Patched HEVC codec brand: hev1 -> hvc1 (MSE compatibility).',
              );
            }
          } catch (e) {
            console.warn('[Player] Failed to patch HEVC codec brand:', e);
          }
        }

        playerOptions.plugins = [FlvPlugin];
        playerOptions.flv = {
          isLive: true,
          cors: true,
          autoCleanupSourceBuffer: true,
          enableWorker: true,
          stashInitialSize: 128,
          lazyLoad: true,
          lazyLoadMaxDuration: 30,
          deferLoadAfterSourceOpen: true,
        };
      }

      const player = new PlayerCtor(playerOptions);
      playerRef.current = player;
      if (!isSessionActive(sessionId)) {
        try {
          player.destroy?.();
        } catch {
          // ignore
        }
        playerRef.current = null;
        return;
      }
      playbackKindRef.current = isHlsPlayback ? 'hls' : 'flv';

      try {
        // xgplayer 的 config 不支持把 muted 作为媒体初始状态(只认 autoplayMuted),
        // 音量已通过 options.volume 注入,这里在构造后立即同步静音状态。
        player.muted = initMuted;
      } catch {
        // ignore
      }

      // 在 xgplayer 的“原生全屏”入口（全屏按钮 / 双击视频都走到 player.getFullscreen()）前
      // 拦一道：若窗口当前处于最大化，先 unmaximize 并记录，再放行元素全屏 —— 元素全屏会让
      // Tauri 把 OS 窗口切成原生全屏，若直接从最大化切过去会与最大化态互斥/丢失状态。
      // 退出全屏后的“恢复最大化”由单例 store 的 resize 处理（syncFromResize）负责，因此这里
      // 不包 exitFullscreen，避免与 Esc 等非代码路径退出重复。
      try {
        if (typeof player.getFullscreen === 'function') {
          const origGetFullscreen = player.getFullscreen.bind(player);
          player.getFullscreen = async (el?: HTMLElement) => {
            await prepareEnterFullscreen();
            const ret = origGetFullscreen(el);
            // 若元素全屏请求失败（例如 await unmaximize 后手势激活丢失），
            // 撤销刚记录的“之前最大化”，避免残留待恢复标记。
            ret.catch(() => {
              clearEnterFullscreenRecord();
            });
            return ret;
          };
        }
      } catch {
        // ignore
      }

      try {
        const onFull = (value: boolean) => setIsFullScreen(!!value);
        const onCssFull = (value: boolean) =>
          setIsFullScreen(!!value || !!player.fullscreen);
        player.on?.('fullscreen_change', onFull);
        player.on?.('cssFullscreen_change', onCssFull);
        player.on?.('destroy', () => setIsFullScreen(false));
      } catch {
        // ignore
      }

      refreshPluginRef.current = player.registerPlugin?.(RefreshControl, {
        position: POSITIONS.CONTROLS_LEFT,
        index: 2,
        onClick: () => void reloadStreamRef.current?.('refresh'),
      });

      volumePluginRef.current = player.registerPlugin?.(VolumeControl, {
        position: POSITIONS.CONTROLS_LEFT,
        index: 3,
      });

      danmuTogglePluginRef.current = player.registerPlugin?.(
        DanmuToggleControl,
        {
          position: POSITIONS.CONTROLS_RIGHT,
          index: 4,
          getState: () => isDanmuEnabled,
          onToggle: (enabled: boolean) => setIsDanmuEnabled(enabled),
        },
      );

      danmuSettingsPluginRef.current = player.registerPlugin?.(
        DanmuSettingsControl,
        {
          position: POSITIONS.CONTROLS_RIGHT,
          index: 4.2,
          getSettings: () => danmuSettings,
          onChange: (partial: Partial<DanmuUserSettings>) => {
            setDanmuSettings((prev) => {
              const next: DanmuUserSettings = { ...prev, ...partial };
              next.area = sanitizeDanmuArea(next.area);
              next.opacity = sanitizeDanmuOpacity(next.opacity);
              if (typeof next.strokeColor !== 'string')
                next.strokeColor = '#444444';
              return next;
            });
          },
        },
      );

      danmuKeywordBlockPluginRef.current = player.registerPlugin?.(
        DanmuKeywordBlockControl,
        {
          position: POSITIONS.CONTROLS_RIGHT,
          index: 4.4,
          getPreferences: () => danmuKeywordBlockPrefsRef.current,
          onChange: (next: DanmuKeywordBlockPreferences) =>
            setDanmuKeywordBlock({
              enabled: true,
              keywords: next.keywords ?? [],
            }),
        },
      );

      qualityPluginRef.current = player.registerPlugin?.(QualityControl, {
        position: POSITIONS.CONTROLS_RIGHT,
        index: 5,
        options: [...QUALITY_OPTIONS],
        getCurrent: () => currentQualityRef.current,
        onSelect: (value: string) => {
          if (value === currentQualityRef.current) return;
          setCurrentQuality(value);
          persistQualityPreference(platform, value);
        },
      });

      linePluginRef.current = player.registerPlugin?.(LineControl, {
        position: POSITIONS.CONTROLS_RIGHT,
        index: 5.2,
        options: [...lineOptions],
        getCurrentKey: () =>
          resolveCurrentLineFor(platform, currentLineRef.current) ?? '',
        getCurrentLabel: () =>
          getLineLabel(
            lineOptionsRef.current,
            resolveCurrentLineFor(platform, currentLineRef.current),
          ),
        onSelect: (lineKey: string) => {
          if (lineKey === currentLineRef.current) return;
          setCurrentLine(lineKey);
          persistLinePreference(platform, lineKey);
        },
      });

      arrangeControlClusters(player);

      // danmu overlay
      const overlay = createDanmuOverlay(
        player,
        danmuSettings,
        isDanmuEnabled,
      ) as DanmuOverlayInstance | null;
      danmuOverlayRef.current = overlay;
      try {
        applyDanmuOverlayPreferences?.(
          overlay,
          danmuSettings,
          isDanmuEnabled,
          player.root as any,
        );
        syncDanmuEnabledState(
          overlay,
          danmuSettings,
          isDanmuEnabled,
          player.root as any,
        );
      } catch {
        // ignore
      }

      const backendRoomId = danmakuBackendRoomIdOverride || roomId;
      const filterRoomId = danmakuFilterRoomIdOverride || backendRoomId;
      await startDanmaku(
        sessionId,
        overlay,
        platform,
        backendRoomId,
        filterRoomId,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      currentLine,
      currentQuality,
      danmuSettings,
      isDanmuEnabled,
      isSessionActive,
      lineOptions,
      platform,
      roomId,
      startDanmaku,
    ],
  );

  const reloadStream = useCallback(
    async (
      _trigger: 'refresh' | 'quality' | 'line',
      overrides?: { quality?: string; line?: string | null },
    ) => {
      if (reloadInFlightRef.current) {
        pendingReloadRef.current = { trigger: _trigger, overrides };
        return;
      }
      reloadInFlightRef.current = true;
      const sessionId = ++sessionSeqRef.current;
      activeSessionIdRef.current = sessionId;

      setIsLoadingStream(true);
      setStreamError(null);
      setIsOfflineError(false);
      setPlayerIsLive(null);
      setPlayerTitle(null);
      setPlayerAnchorName(null);
      setPlayerAvatar(null);

      const effectiveQuality = overrides?.quality ?? currentQuality;
      const effectiveLine =
        typeof overrides?.line !== 'undefined' ? overrides.line : currentLine;

      await stopAllDanmakuBackends();
      await stopAllProxies();
      if (!isSessionActive(sessionId)) return;

      try {
        await applyDanmuFontFamilyForOS();
      } catch {
        // ignore
      }

      try {
        if (platform === Platform.DOUYU) {
          const resolvedLine = resolveCurrentLineFor(platform, effectiveLine);
          try {
            const info = await invoke<any>('fetch_douyu_room_info', { roomId });
            setPlayerTitle(info?.room_name ?? null);
            setPlayerAnchorName(info?.nickname ?? null);
            setPlayerAvatar(info?.avatar_url ?? null);
          } catch {
            // ignore meta fetch failures
          }
          const { streamUrl, streamType } = await getDouyuStreamConfig(
            roomId,
            effectiveQuality,
            resolvedLine,
          );
          if (!isSessionActive(sessionId)) return;
          setPlayerIsLive(true);
          const nextIsHls =
            (streamType || '').toLowerCase() === 'hls' ||
            streamUrl.toLowerCase().includes('.m3u8');
          const nextKind: 'hls' | 'flv' = nextIsHls ? 'hls' : 'flv';
          const player = playerRef.current;
          const canSoftSwitch =
            !!player &&
            !!danmuOverlayRef.current &&
            typeof player.switchURL === 'function' &&
            !!playbackKindRef.current &&
            playbackKindRef.current === nextKind;
          if (canSoftSwitch) {
            try {
              const ret = player.switchURL(streamUrl, { seamless: false });
              if (ret && typeof (ret as any).then === 'function') await ret;
              if (isSessionActive(sessionId)) {
                playbackKindRef.current = nextKind;
                await startDanmaku(
                  sessionId,
                  danmuOverlayRef.current,
                  platform,
                  roomId,
                );
              }
            } catch {
              destroyPlayer();
              await mountPlayer(sessionId, streamUrl, streamType);
            }
          } else {
            destroyPlayer();
            await mountPlayer(sessionId, streamUrl, streamType);
          }
        } else if (platform === Platform.DOUYIN) {
          const resp = await fetchAndPrepareDouyinStreamConfig(
            roomId,
            effectiveQuality,
          );
          if (!isSessionActive(sessionId)) return;
          setPlayerTitle(resp.title ?? null);
          setPlayerAnchorName(resp.anchorName ?? null);
          setPlayerAvatar(resp.avatar ?? null);
          setPlayerIsLive(resp.isLive);
          if (!resp.streamUrl)
            throw new Error(resp.initialError || '主播未开播或无法获取直播流');
          // Douyin backend expects web_rid/live_id to bootstrap cookies, but emitted danmaku payload uses real room_id.
          const danmakuBackendRoomId = resp.webRid || roomId;
          const danmakuFilterRoomId = resp.normalizedRoomId || roomId;
          const nextIsHls =
            (resp.streamType || '').toLowerCase() === 'hls' ||
            resp.streamUrl.toLowerCase().includes('.m3u8');
          const nextKind: 'hls' | 'flv' = nextIsHls ? 'hls' : 'flv';
          const player = playerRef.current;
          const canSoftSwitch =
            !!player &&
            !!danmuOverlayRef.current &&
            typeof player.switchURL === 'function' &&
            !!playbackKindRef.current &&
            playbackKindRef.current === nextKind;
          if (canSoftSwitch) {
            try {
              const ret = player.switchURL(resp.streamUrl, { seamless: false });
              if (ret && typeof (ret as any).then === 'function') await ret;
              if (isSessionActive(sessionId)) {
                playbackKindRef.current = nextKind;
                await startDanmaku(
                  sessionId,
                  danmuOverlayRef.current,
                  platform,
                  danmakuBackendRoomId,
                  danmakuFilterRoomId,
                );
              }
            } catch {
              destroyPlayer();
              await mountPlayer(
                sessionId,
                resp.streamUrl,
                resp.streamType,
                danmakuBackendRoomId,
                danmakuFilterRoomId,
              );
            }
          } else {
            destroyPlayer();
            await mountPlayer(
              sessionId,
              resp.streamUrl,
              resp.streamType,
              danmakuBackendRoomId,
              danmakuFilterRoomId,
            );
          }
        } else if (platform === Platform.HUYA) {
          const resolvedLine = resolveCurrentLineFor(platform, effectiveLine);
          const { streamUrl, streamType, title, anchorName, avatar, isLive } =
            await getHuyaStreamConfig(roomId, effectiveQuality, resolvedLine);
          if (!isSessionActive(sessionId)) return;
          setPlayerTitle(title ?? null);
          setPlayerAnchorName(anchorName ?? null);
          setPlayerAvatar(avatar ?? null);
          setPlayerIsLive(typeof isLive === 'boolean' ? isLive : true);
          const nextIsHls =
            (streamType || '').toLowerCase() === 'hls' ||
            streamUrl.toLowerCase().includes('.m3u8');
          const nextKind: 'hls' | 'flv' = nextIsHls ? 'hls' : 'flv';
          const player = playerRef.current;
          const canSoftSwitch =
            !!player &&
            !!danmuOverlayRef.current &&
            typeof player.switchURL === 'function' &&
            !!playbackKindRef.current &&
            playbackKindRef.current === nextKind;
          if (canSoftSwitch) {
            try {
              const ret = player.switchURL(streamUrl, { seamless: false });
              if (ret && typeof (ret as any).then === 'function') await ret;
              if (isSessionActive(sessionId)) {
                playbackKindRef.current = nextKind;
                await startDanmaku(
                  sessionId,
                  danmuOverlayRef.current,
                  platform,
                  roomId,
                );
              }
            } catch {
              destroyPlayer();
              await mountPlayer(sessionId, streamUrl, streamType);
            }
          } else {
            destroyPlayer();
            await mountPlayer(sessionId, streamUrl, streamType);
          }
        } else if (platform === Platform.BILIBILI) {
          const cookie =
            typeof localStorage !== 'undefined'
              ? localStorage.getItem('bilibili_cookie')
              : null;
          try {
            const payload = { platform, args: { room_id_str: roomId } };
            const info = await invoke<any>('fetch_bilibili_streamer_info', {
              payload,
              cookie: cookie || null,
            });
            setPlayerTitle(info?.title ?? null);
            setPlayerAnchorName(info?.anchor_name ?? null);
            setPlayerAvatar(info?.avatar ?? null);
          } catch {
            // ignore meta fetch failures
          }
          const { streamUrl, streamType } = await getBilibiliStreamConfig(
            roomId,
            effectiveQuality,
            cookie || undefined,
          );
          if (!isSessionActive(sessionId)) return;
          setPlayerIsLive(true);
          const nextIsHls =
            (streamType || '').toLowerCase() === 'hls' ||
            streamUrl.toLowerCase().includes('.m3u8');
          const nextKind: 'hls' | 'flv' = nextIsHls ? 'hls' : 'flv';
          const player = playerRef.current;
          const canSoftSwitch =
            !!player &&
            !!danmuOverlayRef.current &&
            typeof player.switchURL === 'function' &&
            !!playbackKindRef.current &&
            playbackKindRef.current === nextKind;
          if (canSoftSwitch) {
            try {
              const ret = player.switchURL(streamUrl, { seamless: false });
              if (ret && typeof (ret as any).then === 'function') await ret;
              if (isSessionActive(sessionId)) {
                playbackKindRef.current = nextKind;
                await startDanmaku(
                  sessionId,
                  danmuOverlayRef.current,
                  platform,
                  roomId,
                );
              }
            } catch {
              destroyPlayer();
              await mountPlayer(sessionId, streamUrl, streamType);
            }
          } else {
            destroyPlayer();
            await mountPlayer(sessionId, streamUrl, streamType);
          }
        }
      } catch (e: any) {
        if (!isSessionActive(sessionId)) return;
        // When the target room fails to load (e.g. offline), keep UI consistent by clearing any previous playback surface.
        destroyPlayer();
        const msg = e?.message ? String(e.message) : String(e);
        setStreamError(maybeAppendHevcInstallHint(msg));
        // Per product decision: stream load failure => treat as "not live" (最多重试一次后仍失败则认为主播不在线)
        setIsOfflineError(true);
        setPlayerIsLive(false);
      } finally {
        if (isSessionActive(sessionId)) {
          setIsLoadingStream(false);
        }
        reloadInFlightRef.current = false;
        const pending = pendingReloadRef.current;
        pendingReloadRef.current = null;
        if (pending) {
          void reloadStream(pending.trigger, pending.overrides);
        }
      }
    },
    [
      currentLine,
      currentQuality,
      destroyPlayer,
      isSessionActive,
      lineOptions,
      mountPlayer,
      platform,
      roomId,
      stopAllDanmakuBackends,
      stopAllProxies,
      startDanmaku,
    ],
  );

  useEffect(() => {
    reloadStreamRef.current = reloadStream;
  }, [reloadStream]);

  useEffect(() => {
    // Create a per-mount generation id to guard delayed stop against StrictMode(dev) remounts.
    (globalThis as any).__DTV_PLAYER_MOUNT_GEN =
      ((globalThis as any).__DTV_PLAYER_MOUNT_GEN ?? 0) + 1;
    mountGenRef.current = (globalThis as any).__DTV_PLAYER_MOUNT_GEN;
    return () => {
      disposedRef.current = true;
      destroyPlayer();

      const capturedGen = mountGenRef.current;
      const stopAll = () => {
        const currentGen = (globalThis as any).__DTV_PLAYER_MOUNT_GEN ?? 0;
        if (currentGen !== capturedGen) return;
        void stopAllDanmakuBackends();
        void stopAllProxies();
      };
      if (import.meta.env.DEV) {
        window.setTimeout(stopAll, 200);
      } else {
        stopAll();
      }
    };
  }, [destroyPlayer, stopAllDanmakuBackends, stopAllProxies]);

  useEffect(() => {
    disposedRef.current = false;
    void reloadStream('refresh');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, roomId]);

  useEffect(() => {
    // Keep danmu overlay + controls in sync
    import('@/components/player/danmuOverlay')
      .then((mod: any) => {
        mod.applyDanmuOverlayPreferences?.(
          danmuOverlayRef.current,
          danmuSettings,
          isDanmuEnabled,
          playerRef.current?.root as any,
        );
        mod.syncDanmuEnabledState?.(
          danmuOverlayRef.current,
          danmuSettings,
          isDanmuEnabled,
          playerRef.current?.root as any,
        );
      })
      .catch(() => {});

    try {
      persistDanmuPreferences({
        enabled: isDanmuEnabled,
        settings: danmuSettings,
      });
    } catch {
      // ignore
    }

    try {
      danmuTogglePluginRef.current?.setState?.(isDanmuEnabled);
      danmuSettingsPluginRef.current?.setSettings?.(danmuSettings);
    } catch {
      // ignore
    }
  }, [danmuSettings, isDanmuEnabled]);

  useEffect(() => {
    try {
      persistDanmuKeywordBlockPreferences(danmuKeywordBlock);
    } catch {
      // ignore
    }

    try {
      danmuKeywordBlockPluginRef.current?.setPreferences?.(danmuKeywordBlock);
    } catch {
      // ignore
    }
  }, [danmuKeywordBlock]);

  useEffect(() => {
    try {
      qualityPluginRef.current?.setOptions?.([...QUALITY_OPTIONS]);
      qualityPluginRef.current?.updateLabel?.(currentQuality);
      linePluginRef.current?.setOptions?.([...lineOptions]);
      linePluginRef.current?.updateLabel?.(
        getLineLabel(lineOptions, resolveCurrentLineFor(platform, currentLine)),
      );
    } catch {
      // ignore
    }
  }, [currentLine, currentQuality, lineOptions, platform]);

  useEffect(() => {
    // quality / line change triggers reload (debounced a bit)
    if (!qualityReloadArmedRef.current) {
      qualityReloadArmedRef.current = true;
      return;
    }
    const id = window.setTimeout(() => void reloadStream('quality'), 80);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuality, currentLine]);

  return {
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
  };
}
