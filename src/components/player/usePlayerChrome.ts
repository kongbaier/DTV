'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

// App chrome / 播放器交互区域排除清单：这些子树不参与整页窗口拖拽。
export const PLAYER_DRAG_EXCLUDED_SELECTOR = [
  // App chrome / topbar (主播信息栏 & 关闭/关注按钮等)
  '.player-topbar',
  '.player-window-controls',
  // Stream error overlay (中间刷新按钮)
  '.retry-btn',
  // Generic interactive elements
  'button',
  'a',
  'input',
  'textarea',
  'select',
  "[role='button']",
  "[role='link']",
  "[contenteditable='true']",
  // xgplayer controls / popups (播放器控制栏及其菜单)
  '.xgplayer-controls',
  '.xgplayer-controls *',
  '.xgplayer-danmu-block-panel',
  '.xgplayer-danmu-settings-panel',
  '.xgplayer-quality-dropdown',
  '.xgplayer-line-dropdown',
].join(', ');

/** 播放页顶栏/窗口控制条的闲置自动隐藏（8s 无鼠标活动则隐藏 chrome，隐藏后任意移动即重现）。 */
export function usePlayerChrome(): {
  pageRef: RefObject<HTMLDivElement | null>;
  chromeHiddenClass: '' | ' player-chrome-hidden';
} {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const hideChromeTimerRef = useRef<number | null>(null);
  const moveRafRef = useRef(0);

  useEffect(() => {
    const armHide = () => {
      if (hideChromeTimerRef.current)
        window.clearTimeout(hideChromeTimerRef.current);
      hideChromeTimerRef.current = window.setTimeout(() => {
        try {
          const root = pageRef.current;
          const active =
            typeof document !== 'undefined'
              ? (document.activeElement as HTMLElement | null)
              : null;
          const hasOpenMenu = !!root?.querySelector?.(
            '.xgplayer-danmu-block.menu-open, .xgplayer-danmu-settings.menu-open, .xgplayer-quality-control.menu-open, .xgplayer-line-control.menu-open',
          );
          const isEditingInPopup =
            !!active &&
            !!root &&
            root.contains(active) &&
            !!active.closest?.(
              '.xgplayer-danmu-block-panel, .xgplayer-danmu-settings-panel, .xgplayer-quality-dropdown, .xgplayer-line-dropdown',
            );

          if (hasOpenMenu || isEditingInPopup) {
            setChromeVisible(true);
            armHide();
            return;
          }
        } catch {
          // ignore
        }
        setChromeVisible(false);
      }, 8000);
    };

    // Start hidden-after-idle behavior immediately on mount.
    setChromeVisible(true);
    armHide();

    const onMove = () => {
      if (moveRafRef.current) return;
      moveRafRef.current = window.requestAnimationFrame(() => {
        moveRafRef.current = 0;
        setChromeVisible(true);
        armHide();
      });
    };

    // Listen on `window` to avoid WebView/video layers swallowing pointer events.
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove as any);
      window.removeEventListener('pointermove', onMove as any);
      if (hideChromeTimerRef.current)
        window.clearTimeout(hideChromeTimerRef.current);
      if (moveRafRef.current) window.cancelAnimationFrame(moveRafRef.current);
      hideChromeTimerRef.current = null;
      moveRafRef.current = 0;
    };
  }, []);

  const chromeHiddenClass: '' | ' player-chrome-hidden' = chromeVisible
    ? ''
    : ' player-chrome-hidden';

  return { pageRef, chromeHiddenClass };
}
