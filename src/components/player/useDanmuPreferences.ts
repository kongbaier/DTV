'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  DANMU_BLOCK_KEYWORDS_CHANGED_EVENT,
  DEFAULT_DANMU_SETTINGS,
  loadDanmuKeywordBlockPreferences,
  loadDanmuPreferences,
  type DanmuKeywordBlockPreferences,
  type DanmuUserSettings,
} from '@/components/player/constants';

export type DanmuPreferences = {
  isDanmuEnabled: boolean;
  danmuSettings: DanmuUserSettings;
  danmuKeywordBlock: DanmuKeywordBlockPreferences;
  setIsDanmuEnabled: Dispatch<SetStateAction<boolean>>;
  setDanmuSettings: Dispatch<SetStateAction<DanmuUserSettings>>;
  setDanmuKeywordBlock: Dispatch<SetStateAction<DanmuKeywordBlockPreferences>>;
};

const EMPTY_KEYWORDS: DanmuKeywordBlockPreferences = {
  enabled: true,
  keywords: [],
};

/** 弹幕偏好（开关 / 样式设置 / 关键词屏蔽）的本地状态与跨窗口变更监听。 */
export function useDanmuPreferences(): DanmuPreferences {
  const [isDanmuEnabled, setIsDanmuEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = loadDanmuPreferences();
    return stored?.enabled ?? true;
  });
  const [danmuSettings, setDanmuSettings] = useState<DanmuUserSettings>(() => {
    if (typeof window === 'undefined') return DEFAULT_DANMU_SETTINGS;
    const stored = loadDanmuPreferences();
    return stored?.settings ?? DEFAULT_DANMU_SETTINGS;
  });
  const [danmuKeywordBlock, setDanmuKeywordBlock] =
    useState<DanmuKeywordBlockPreferences>(() => {
      if (typeof window === 'undefined') return EMPTY_KEYWORDS;
      const loaded = loadDanmuKeywordBlockPreferences();
      return loaded ? { enabled: true, keywords: loaded.keywords } : EMPTY_KEYWORDS;
    });

  // 其它窗口（如同一配置下的弹幕屏蔽面板）改词后同步到本窗口状态。
  useEffect(() => {
    const keywordsEqual = (left: string[], right: string[]) => {
      if (left === right) return true;
      if (left.length !== right.length) return false;
      for (let i = 0; i < left.length; i += 1) {
        if (left[i] !== right[i]) return false;
      }
      return true;
    };

    const onKeywordsChanged = () => {
      const next = loadDanmuKeywordBlockPreferences();
      const nextKeywords = next?.keywords ?? [];
      setDanmuKeywordBlock((prev) => {
        const prevKeywords = prev.keywords ?? [];
        if (keywordsEqual(prevKeywords, nextKeywords)) {
          return prev;
        }
        return { enabled: true, keywords: nextKeywords };
      });
    };

    window.addEventListener(
      DANMU_BLOCK_KEYWORDS_CHANGED_EVENT,
      onKeywordsChanged as EventListener,
    );
    return () =>
      window.removeEventListener(
        DANMU_BLOCK_KEYWORDS_CHANGED_EVENT,
        onKeywordsChanged as EventListener,
      );
  }, []);

  return {
    isDanmuEnabled,
    danmuSettings,
    danmuKeywordBlock,
    setIsDanmuEnabled,
    setDanmuSettings,
    setDanmuKeywordBlock,
  };
}
