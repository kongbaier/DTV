'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { CommonStreamer } from '@/platforms/common/streamerTypes';
import { useImageProxy } from '@/hooks/useImageProxy';

export interface UseHuyaLiveRoomsOptions {
  defaultPageSize?: number;
}

export function useHuyaLiveRooms(
  gid: string | null,
  options: UseHuyaLiveRoomsOptions = { defaultPageSize: 120 },
) {
  const [rooms, setRooms] = useState<CommonStreamer[]>([]);
  // 实例生命周期由调用方通过分类 key 约束（切换分类即重挂载），参数在实例内恒定；
  // 参数有效则挂载即拉取，故初始 isLoading 直接反映参数是否有效，避免首帧闪空态。
  const [isLoading, setIsLoading] = useState(() => !!gid);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const pageSize = options.defaultPageSize ?? 120;
  // 对相同 (gid, page, pageSize) 的并发请求去重（防止 loadMore 抖动重复发起）。
  const inflightRef = useRef<Map<string, Promise<void>>>(new Map());

  const { proxify, ensureProxyStarted } = useImageProxy();

  const huyaCoverParams =
    'x-oss-process=image/resize,limit_0,m_fill,w_338,h_190/sharpen,80/format,jpg/interlace,1/quality,q_90';
  const appendHuyaCoverParams = useCallback((url: string) => {
    if (!url) return url;
    if (url.includes('x-oss-process=')) return url;
    return url.includes('?')
      ? `${url}&${huyaCoverParams}`
      : `${url}?${huyaCoverParams}`;
  }, []);

  const mapHuyaItemToCommonStreamer = useCallback(
    (item: any): CommonStreamer => {
      const viewers = typeof item.lUserCount === 'number' ? item.lUserCount : 0;
      const rawCover = item.room_cover || item.sScreenshot || '';
      return {
        room_id:
          item.room_id?.toString() || item.lProfileRoom?.toString() || '',
        title: item.title || item.sIntroduction || '',
        nickname: item.nickname || item.sNick || '',
        avatar: proxify(item.avatar || item.sAvatar180 || ''),
        room_cover: proxify(appendHuyaCoverParams(rawCover)),
        viewer_count_str:
          item.viewer_count_str || (viewers ? `${viewers}` : '0'),
        platform: 'huya',
      };
    },
    [appendHuyaCoverParams, proxify],
  );

  const fetchRooms = useCallback(
    async (pageNo: number, loadMore: boolean) => {
      if (!gid) {
        setRooms([]);
        setHasMore(false);
        setCurrentPage(1);
        return;
      }

      const requestKey = `${gid}:${pageNo}:${pageSize}`;
      const existing = inflightRef.current.get(requestKey);
      if (existing) return existing;

      const task = (async () => {
        // loading 标志由入口设置：挂载路径初始 isLoading 已为 true，
        // 重试/loadMore 分别在 loadInitialRooms/loadMoreRooms（事件路径）置位。
        await ensureProxyStarted();

        try {
          const resp = await invoke<{
            error: number;
            msg?: string;
            data?: any[];
          }>('fetch_huya_live_list', {
            iGid: gid,
            iPageNo: pageNo,
            iPageSize: pageSize,
          });

          if (resp.error !== 0 || !Array.isArray(resp.data))
            throw new Error(resp.msg || '虎牙接口返回错误');
          const newRooms = resp.data.map(mapHuyaItemToCommonStreamer);
          setRooms((prev) => (loadMore ? [...prev, ...newRooms] : newRooms));
          setHasMore(newRooms.length === pageSize);
          setCurrentPage(pageNo + 1);
        } catch (e: any) {
          console.error('[useHuyaLiveRooms] invoke error', e);
          setError(e?.message || '加载失败');
          if (!loadMore) {
            setRooms([]);
            setHasMore(false);
          }
        } finally {
          if (loadMore) setIsLoadingMore(false);
          else setIsLoading(false);
        }
      })();

      inflightRef.current.set(requestKey, task);
      try {
        await task;
      } finally {
        inflightRef.current.delete(requestKey);
      }
    },
    [ensureProxyStarted, gid, mapHuyaItemToCommonStreamer, pageSize],
  );

  // 重试入口（事件路径，覆盖错误残留时才需要重置 + 置 loading）。
  const loadInitialRooms = useCallback(async () => {
    setRooms([]);
    setHasMore(true);
    setCurrentPage(1);
    setError(null);
    setIsLoading(true);
    await fetchRooms(1, false);
  }, [fetchRooms]);

  const loadMoreRooms = useCallback(async () => {
    if (!hasMore || isLoading || isLoadingMore) return;
    setError(null);
    setIsLoadingMore(true);
    await fetchRooms(currentPage, true);
  }, [currentPage, fetchRooms, hasMore, isLoading, isLoadingMore]);

  // 挂载时直接走 fetchRooms（不重置）：实例刚挂载，rooms 为空、isLoading 已为 true；
  // 重试按钮才走 loadInitialRooms（事件路径）。
  // set-state-in-effect 规则不追踪跨函数调用的 await，fire-and-forget 调用 loader
  // 会把它内部任意可达 setState 当成同步 setState；故在 effect 内词法 await 先让出。
  useEffect(() => {
    if (!gid) return;
    void (async () => {
      await fetchRooms(1, false);
    })();
  }, [fetchRooms, gid]);

  return {
    rooms,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    loadInitialRooms,
    loadMoreRooms,
  };
}
