'use client';

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { CommonStreamer } from '@/platforms/common/streamerTypes';

interface DouyuStreamer {
  rid: string;
  roomName: string;
  nickname: string;
  roomSrc: string;
  avatar: string;
  hn: string;
  isLive?: boolean;
}

interface LiveListDataWrapper {
  list: DouyuStreamer[];
  total?: number;
  page_count?: number;
}

interface LiveListApiResponse {
  error: number;
  msg?: string;
  data?: LiveListDataWrapper;
}

const PAGE_SIZE = 20;

export function useDouyuLiveRooms(
  categoryType: 'cate2' | 'cate3' | null,
  categoryId: string | null,
) {
  const [rooms, setRooms] = useState<CommonStreamer[]>([]);
  // 实例生命周期由调用方通过分类 key 约束（切换分类即重挂载），参数在实例内恒定；
  // 参数有效则挂载即拉取，故初始 isLoading 直接反映参数是否有效，避免首帧闪空态。
  const [isLoading, setIsLoading] = useState(
    () => !!categoryType && !!categoryId,
  );
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);

  const mapDouyuItemToCommon = useCallback(
    (item: DouyuStreamer): CommonStreamer => {
      return {
        room_id: item.rid?.toString() || '',
        title: item.roomName || '',
        nickname: item.nickname || '',
        avatar: item.avatar || '',
        room_cover: item.roomSrc || '',
        viewer_count_str: item.hn || '0',
        platform: 'douyu',
      };
    },
    [],
  );

  const fetchRooms = useCallback(
    async (pageToFetch: number, loadMore: boolean) => {
      if (!categoryType || !categoryId) {
        setRooms([]);
        setHasMore(false);
        setCurrentPage(0);
        return;
      }

      // loading 标志不在这里同步设置：由挂载（初始 isLoading 已为 true）或
      // 事件入口（loadInitialRooms/loadMoreRooms）设置，避免挂载 effect 同步 setState。
      let command = '';
      let params: Record<string, unknown> = {};
      if (categoryType === 'cate2') {
        command = 'fetch_live_list';
        params = {
          cate2: categoryId,
          offset: pageToFetch * PAGE_SIZE,
          limit: PAGE_SIZE,
        };
      } else {
        command = 'fetch_live_list_for_cate3';
        params = {
          cate3Id: categoryId,
          page: pageToFetch + 1,
          limit: PAGE_SIZE,
        };
      }

      try {
        const resp = await invoke<LiveListApiResponse>(command, params);
        if (resp.error !== 0 || !resp.data)
          throw new Error(resp.msg || '斗鱼接口返回错误');

        const newRooms = (resp.data.list || []).map(mapDouyuItemToCommon);
        setRooms((prev) =>
          pageToFetch === 0 ? newRooms : [...prev, ...newRooms],
        );

        if (resp.data.total !== undefined) {
          const totalFetched = (pageToFetch + 1) * PAGE_SIZE;
          setHasMore(resp.data.total > totalFetched && newRooms.length > 0);
        } else if (resp.data.page_count !== undefined) {
          setHasMore(
            pageToFetch + 1 < resp.data.page_count && newRooms.length > 0,
          );
        } else {
          setHasMore(newRooms.length === PAGE_SIZE);
        }

        setCurrentPage(pageToFetch);
      } catch (e) {
        console.error('[useDouyuLiveRooms] invoke error', e);
        if (pageToFetch === 0) setRooms([]);
        setHasMore(false);
      } finally {
        if (loadMore) setIsLoadingMore(false);
        else setIsLoading(false);
      }
    },
    [categoryId, categoryType, mapDouyuItemToCommon],
  );

  // 不重置的首次装载：实例刚挂载时 rooms 已为空、isLoading 已为 true。
  const loadInitialRooms = useCallback(async () => {
    await fetchRooms(0, false);
  }, [fetchRooms]);

  const loadMoreRooms = useCallback(async () => {
    if (!hasMore || isLoading || isLoadingMore) return;
    setIsLoadingMore(true);
    await fetchRooms(currentPage + 1, true);
  }, [currentPage, fetchRooms, hasMore, isLoading, isLoadingMore]);

  // 挂载时拉取第一页；分类切换（含 cate2/cate3 维度）会经调用方 key 整体重挂载，
  // 参数在实例内恒定，无需响应参数变化，参数为空的实例也不会发起任何请求。
  // set-state-in-effect 规则不追踪跨函数调用的 await，fire-and-forget 调用 loader
  // 会把它内部任意可达 setState 当成同步 setState；故在 effect 内词法 await 先让出。
  useEffect(() => {
    if (!categoryType || !categoryId) return;
    void (async () => {
      await loadInitialRooms();
    })();
  }, [categoryId, categoryType, loadInitialRooms]);

  return {
    rooms,
    isLoading,
    isLoadingMore,
    hasMore,
    loadInitialRooms,
    loadMoreRooms,
  };
}
