'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { CommonStreamer } from '@/platforms/common/streamerTypes';
import { logger } from '@/utils/logger';

export function useDouyinLiveRooms(
  partitionId: string | null,
  partitionTypeId: string | null,
) {
  const [rooms, setRooms] = useState<CommonStreamer[]>([]);
  // 实例生命周期由调用方通过分类 key 约束（切换分类即重挂载），参数在实例内恒定；
  // 参数有效则挂载即拉取，故初始 isLoading 直接反映参数是否有效，避免首帧闪空态。
  const [isLoading, setIsLoading] = useState(
    () => !!partitionId && !!partitionTypeId,
  );
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentOffset, setCurrentOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const msTokenRef = useRef<string | null>(null);

  const fetchAndSetMsToken = useCallback(async (): Promise<string | null> => {
    try {
      const token = await invoke<string>('generate_douyin_ms_token');
      msTokenRef.current = token;
      return token;
    } catch (e) {
      console.error('[useDouyinLiveRooms] Failed to fetch msToken:', e);
      setError('Failed to initialize session token.');
      msTokenRef.current = null;
      return null;
    }
  }, []);

  const mapRawRoomToCommonStreamer = useCallback(
    (rawRoom: any): CommonStreamer => {
      const webId = rawRoom.web_rid?.toString?.() || '';
      return {
        room_id: webId || `N/A_RID_${Math.random()}`,
        title: rawRoom.title || '未知标题',
        nickname: rawRoom.owner_nickname || '未知主播',
        avatar: rawRoom.avatar_url || '',
        room_cover:
          rawRoom.cover_url ||
          'https://via.placeholder.com/320x180.png?text=No+Image',
        viewer_count_str: rawRoom.user_count_str || '0 人',
        platform: 'douyin',
        web_id: webId,
      };
    },
    [],
  );

  const fetchRooms = useCallback(
    async (
      offset: number,
      loadMore: boolean,
      tokenOverride?: string | null,
    ) => {
      if (!partitionId || !partitionTypeId) {
        setRooms([]);
        setCurrentOffset(0);
        setHasMore(false);
        setError(null);
        return;
      }

      const msToken = tokenOverride ?? msTokenRef.current;
      if (!msToken) {
        setError(
          'Session token is missing. Please refresh or select category again.',
        );
        setHasMore(false);
        return;
      }

      if (loadMore) setIsLoadingMore(true);
      else setIsLoading(true);
      setError(null);

      try {
        logger.debug('[useDouyinLiveRooms] fetch rooms', {
          partition: partitionId,
          partition_type: partitionTypeId,
          offset,
        });
        const response = await invoke<any>('fetch_douyin_partition_rooms', {
          partition: partitionId,
          partitionType: partitionTypeId,
          offset,
          msToken: msToken,
        });

        if (response && Array.isArray(response.rooms)) {
          const newRooms = response.rooms.map(mapRawRoomToCommonStreamer);
          setRooms((prev) => (loadMore ? [...prev, ...newRooms] : newRooms));
          setHasMore(Boolean(response.has_more));
          const nextOffset = response.next_offset ?? offset + newRooms.length;
          setCurrentOffset(
            typeof nextOffset === 'string' ? Number(nextOffset) : nextOffset,
          );
        } else {
          logger.warn(
            '[useDouyinLiveRooms] No rooms array in response or invalid structure (expected response.rooms to be an array).',
          );
          if (!loadMore) setRooms([]);
          setHasMore(false);
        }
      } catch (e: any) {
        logger.error('[useDouyinLiveRooms] Error fetching rooms:', e);
        // 提取更友好的错误信息
        let errorMsg =
          typeof e === 'string' ? e : e?.message || 'Failed to fetch rooms';
        // 如果是抖音 API 的错误，显示更友好的提示
        if (
          errorMsg.includes('抖音 API 错误') ||
          errorMsg.includes('抖音 API 返回错误')
        ) {
          errorMsg =
            errorMsg +
            '\n\n可能原因：\n1. Cookie 已过期，需要更新\n2. 网络环境问题\n3. 抖音 API 限制\n\n请尝试：\n- 重新选择分类\n- 检查网络连接\n- 稍后再试';
          // API 错误时设置 hasMore 为 false，避免无限重试
          setHasMore(false);
        }
        setError(errorMsg);
        if (!loadMore) {
          setRooms([]);
          setHasMore(false);
        }
      } finally {
        if (loadMore) setIsLoadingMore(false);
        else setIsLoading(false);
      }
    },
    [mapRawRoomToCommonStreamer, partitionId, partitionTypeId],
  );

  // 不重置的首次装载：实例刚挂载时 rooms 已为空、isLoading 已为 true；
  // 重试场景下 fetchRooms 会在取到 token 后（异步）把 isLoading 置 true。
  const loadInitialRooms = useCallback(async () => {
    const token = await fetchAndSetMsToken();
    if (!token) {
      setIsLoading(false);
      setHasMore(false);
      return;
    }
    await fetchRooms(0, false, token);
  }, [fetchAndSetMsToken, fetchRooms]);

  const loadMoreRooms = useCallback(async () => {
    if (!hasMore || isLoading || isLoadingMore || !msTokenRef.current) return;
    await fetchRooms(currentOffset, true);
  }, [currentOffset, fetchRooms, hasMore, isLoading, isLoadingMore]);

  // 挂载时拉取第一页；分类切换会经调用方 key 整体重挂载，无需响应参数变化。
  // set-state-in-effect 规则不追踪跨函数调用的 await，fire-and-forget 调用 loader
  // 会把它内部任意可达 setState 当成同步 setState；故在 effect 内词法 await 先让出。
  useEffect(() => {
    if (!partitionId || !partitionTypeId) return;
    logger.debug('[useDouyinLiveRooms] load initial', {
      partitionId,
      partitionTypeId,
    });
    void (async () => {
      await loadInitialRooms();
    })();
  }, [loadInitialRooms, partitionId, partitionTypeId]);

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
