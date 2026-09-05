import { getCurrentWindow, type Window } from '@tauri-apps/api/window';
import { useEffect } from 'react';

type UseWindowDragOptions = {
  /** 是否禁用拖拽，常用于全屏等场景，默认 false */
  disabled?: boolean;
  /** 是否启用双击最大化/还原，默认 true */
  doubleClick?: boolean;
  /** 触发拖拽前的鼠标移动阈值（像素），默认 3 */
  threshold?: number;
  /** 命中选择器的元素（含其内嵌于可拖子树中的子孙）一律不可拖。
   *  用于排除无法打 data 属性的三方内部子树（如 xgplayer 控件/弹层），
   *  判定等价于 target.closest(exclude)：沿事件路径逐元素 matches */
  exclude?: string;
  /** 可注入外部 Window 实例（用于测试），默认自动获取 */
  appWindow?: Window;
};

// 复刻 Tauri 原生 drag-region 脚本的可交互判定集合，比单纯 button/a/input 覆盖更全
// （含 contenteditable / tabindex / 交互性 role 等，见 tauri drag.js）
const CLICKABLE_TAGS = new Set([
  'A',
  'BUTTON',
  'INPUT',
  'SELECT',
  'TEXTAREA',
  'LABEL',
  'SUMMARY',
]);
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'tab',
  'checkbox',
  'radio',
  'switch',
  'option',
]);
const isClickable = (el: HTMLElement) =>
  CLICKABLE_TAGS.has(el.tagName) ||
  (el.hasAttribute('contenteditable') &&
    el.getAttribute('contenteditable') !== 'false') ||
  (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1') ||
  INTERACTIVE_ROLES.has(el.getAttribute('role') ?? '');

/**
 * 提供符合桌面端应用预期的窗口拖拽功能。
 *
 * 替代 Tauri 内置的 `data-tauri-drag-region`：区域判定沿事件 composedPath 自下而上、
 * 最近标记优先 —— 可交互元素（按钮/链接/输入/`tabindex`/role 等）无标记即拦截；
 * `data-${dragAttr}="false"` 屏蔽整棵子树；其余任意值（含裸属性）表示整棵子树为可拖区域。
 *
 * 拖拽采用与播放页自研逻辑一致的「候选 + 指针 ID 配对 + 移动阈值」机制：
 * 在可拖区域内按下左键先记候选，指针移动超过阈值才调用 `startDragging()`；
 * 不在 down 时立刻起拖，保证区域内的单击/双击等交互不受影响。监听器常驻、
 * 每次按下覆盖候选、松开/失焦/`buttons` 兜底，因此鼠标在窗口外松开也不会残留
 * 监听器或产生无按键的“幽灵拖拽”。双击最大化统一走 capture 阶段的 `dblclick`
 * （mouseup 语义），Windows/macOS 行为一致。
 *
 * @param dragAttr - 用于标记可拖拽区域的自定义属性名（不含 `data-` 前缀）；
 *                   实际查找 `data-${dragAttr}`
 * @param options - 可选配置
 *
 * @example
 * ```tsx
 * // 在某处（如 AppShell）挂载一次即可覆盖全应用
 * useWindowDrag('drag-region');
 *
 * <header data-drag-region>
 *   <span>标题</span>
 *   <button data-drag-region="false">按钮</button>
 * </header>
 * ```
 */
export function useWindowDrag(
  dragAttr: string,
  {
    disabled = false,
    doubleClick = true,
    threshold = 3,
    exclude,
    appWindow,
  }: UseWindowDragOptions = {},
) {
  useEffect(() => {
    if (disabled) return;
    const attr = `data-${dragAttr}`;

    // 纯浏览器环境（pnpm dev）没有 Tauri 注入，getCurrentWindow 会抛错 → 静默不启用
    const currentWindow: Window | null = (() => {
      try {
        return appWindow ?? getCurrentWindow();
      } catch {
        return null;
      }
    })();
    if (!currentWindow) return;

    // 区域判定：自 target 向上找最近标记。
    //   命中 exclude 子树 → 拦截（不拖、不双击最大化）
    //   可交互但无标记 → 拦截（不拖、不双击最大化）
    //   无标记 → 继续上溯
    //   ="false" → 屏蔽该子树
    //   其余任意值（含裸属性）→ 整棵子树为可拖区域
    const isRegion = (path: EventTarget[]): boolean => {
      for (const el of path) {
        if (!(el instanceof HTMLElement)) continue;
        if (exclude && el.matches(exclude)) return false;
        const value = el.getAttribute(attr);
        if (isClickable(el) && value === null) return false;
        if (value === null) continue;
        return value !== 'false';
      }
      return false;
    };

    // 候选拖拽：pointerdown 在区域内按下即记下起点，移动超阈值才真正 startDragging
    let candidate: { pointerId: number; x: number; y: number } | null = null;
    let dragging = false;

    const clearCandidate = () => {
      candidate = null;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // 新按下：复位上一次状态并覆盖候选（同一效果内同时只会有一个待判定拖拽）
      dragging = false;
      clearCandidate();
      if (!isRegion(e.composedPath())) return;
      // 与播放页自研拖拽一致，用 clientX/clientY 做位移判断（screenX/Y 在 WebView2
      // 高分屏/多显示器下不可靠，可能导致位移永远算不超阈值）
      candidate = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!candidate || candidate.pointerId !== e.pointerId) return;
      if (dragging) return;
      // 兜底：按钮已松开（如指针在窗口外松开未收到 up）→ 清空候选，避免幽灵拖拽
      if ((e.buttons & 1) === 0) {
        clearCandidate();
        return;
      }
      const dx = e.clientX - candidate.x;
      const dy = e.clientY - candidate.y;
      if (dx * dx + dy * dy < threshold * threshold) return;

      dragging = true;
      clearCandidate();
      // 阻止文字选择 / 原生拖拽干扰，再交给系统拖起窗口
      e.preventDefault();
      currentWindow
        .startDragging()
        .catch(() => {})
        .finally(() => {
          // 原生拖拽结束后复位，让下一次按下可再次拖拽
          dragging = false;
        });
    };

    const onPointerEnd = (e: PointerEvent) => {
      if (candidate && candidate.pointerId === e.pointerId) clearCandidate();
    };

    const onDblClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (!isRegion(e.composedPath())) return;
      e.preventDefault(); // 避免双击选中标题文字
      void currentWindow.toggleMaximize().catch(() => {});
    };

    // 窗口失焦兜底：残留候选/拖拽状态全部复位
    const onBlur = () => {
      clearCandidate();
      dragging = false;
    };

    // capture 阶段监听，避免子组件 stopPropagation 吞掉事件
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerEnd, true);
    window.addEventListener('pointercancel', onPointerEnd, true);
    window.addEventListener('blur', onBlur);
    if (doubleClick) window.addEventListener('dblclick', onDblClick, true);

    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerEnd, true);
      window.removeEventListener('pointercancel', onPointerEnd, true);
      window.removeEventListener('blur', onBlur);
      if (doubleClick) window.removeEventListener('dblclick', onDblClick, true);
    };
  }, [dragAttr, disabled, doubleClick, threshold, exclude, appWindow]);
}
