'use client';

import { useSyncExternalStore } from 'react';

// —— useWindowState：窗口状态 + 动作的单一出口 ——
//
// 需求：Navbar 与 MainPlayer（/player 路由、overlay）各自维护一份“窗口是否最大化”其实是
// 同一份 OS 状态，却只能靠各组件自挂 onResized 勉强同步，逻辑整份重复。这里把窗口状态收到
// 模块作用域，用 React 内置的 useSyncExternalStore 消费：
//   - 两个组件读到的是同一个快照 → 天然等价，无“同步两份 state”的问题；
//   - 全局只挂一个真实的 window onResized 监听（惰性启动一次）；
//   - 全屏 ⇄ 最大化的互斥协调（见下）也内聚于此，动作对调用方是纯函数。
// 遵循 hooks 惯例：文件按 useXxx 命名，对外只暴露 useWindowState() 一个 hook，返回
// “状态 + 动作”对象；store/内部函数保持模块私有，调用方一律经 hook 拿到，不散落 import。
//
// 背景：Tauri 下 WebView 元素进入全屏时，窗口会被自动切成 OS 原生全屏（tauri-runtime-wry 的
// ContainsFullScreenElementChanged 处理），与“最大化”态互斥。因此进入全屏前若窗口已最大化，
// 须先 unmaximize 并记录，退出全屏（OS 原生全屏回落）后再恢复最大化；反向亦然。

export type FullscreenPeer = {
  /** 退出元素全屏（xgplayer player.exitFullscreen），OS 原生全屏会随之关闭 */
  exitFullscreen?: () => Promise<unknown>;
  /** 重新进入元素全屏（xgplayer player.getFullscreen） */
  getFullscreen?: () => Promise<unknown>;
};

export type WindowStateSnapshot = {
  isWindows: boolean;
  isMaximized: boolean;
  /** 是否处于 OS 原生全屏（由元素全屏引起，或窗口层 setFullscreen） */
  isFullscreen: boolean;
};

const INITIAL_SNAPSHOT: WindowStateSnapshot = {
  isWindows: false,
  isMaximized: false,
  isFullscreen: false,
};

// 对外快照：仅在字段变化时重建引用，满足 useSyncExternalStore 的稳定性要求。
let snapshot: WindowStateSnapshot = INITIAL_SNAPSHOT;
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};

function setSnapshot(patch: Partial<WindowStateSnapshot>) {
  let changed = false;
  const next = { ...snapshot };
  for (const key of Object.keys(patch) as (keyof WindowStateSnapshot)[]) {
    if (next[key] !== patch[key]) {
      next[key] = patch[key] as boolean;
      changed = true;
    }
  }
  if (!changed) return;
  snapshot = next;
  notify();
}

// —— 全屏 ⇄ 最大化协调的内部记录（不进对外快照） ——
let wasMaximizedBeforeFullscreen = false; // 进全屏前是否处于最大化（退出全屏后补回）
let prevOsFullscreen = false; // 上一次 resize 是否处于 OS 全屏（识别下落沿）
let prevWasFullscreen = false; // 全屏→最大化 后，“还原”应回到全屏

let started = false;

function isWindowsPlatform(raw: string) {
  const p = String(raw || '').toLowerCase();
  return p === 'windows' || p === 'linux';
}

/** 等窗口真正脱离 OS 原生全屏（元素全屏退出的完成是异步的），避免窗口操作与全屏切换打架 */
async function waitWindowFullscreenOff(win: any, maxAttempts = 40) {
  for (let i = 0; i < maxAttempts; i += 1) {
    let fs = true;
    try {
      fs = !!(await win.isFullscreen());
    } catch {
      return;
    }
    if (!fs) return;
    await new Promise((r) => window.setTimeout(r, 20));
  }
}

async function syncFromResize(win: any) {
  let isMax = false;
  let isFs = false;
  try {
    isMax = !!(await win.isMaximized());
  } catch {
    // ignore
  }
  try {
    isFs = !!(await win.isFullscreen());
  } catch {
    // ignore
  }
  setSnapshot({ isMaximized: isMax, isFullscreen: isFs });

  // 识别“OS 原生全屏 → 非全屏”的下落沿：若进全屏前记录过“处于最大化”，此刻补回最大化
  const wasFullscreen = prevOsFullscreen;
  prevOsFullscreen = isFs;
  if (wasFullscreen && !isFs && wasMaximizedBeforeFullscreen) {
    wasMaximizedBeforeFullscreen = false;
    try {
      if (!(await win.isMaximized())) await win.maximize();
    } catch {
      // ignore
    }
  }
  // 窗口回到普通大小（如被拖拽还原）：先前“全屏 → 最大化”留下的“还原回全屏”上下文作废
  if (!isFs && !isMax) prevWasFullscreen = false;
}

/** 惰性启动一次：探测平台 + 初始查询 + 挂唯一的 onResized 监听 */
function ensureStarted() {
  if (started) return;
  started = true;
  void (async () => {
    let win = null;
    let isWin = false;
    try {
      const osMod: any = await import('@tauri-apps/plugin-os');
      const p =
        typeof osMod?.platform === 'function' ? await osMod.platform() : '';
      isWin = isWindowsPlatform(p);
    } catch {
      // non-tauri env: ignore
    }
    if (!isWin) {
      setSnapshot({ isWindows: false });
      return;
    }
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      win = getCurrentWindow();
    } catch {
      // ignore
    }
    setSnapshot({ isWindows: true });
    if (!win) return;
    try {
      const isFs = !!(await win.isFullscreen());
      let max = false;
      try {
        max = !!(await win.isMaximized());
      } catch {
        // ignore
      }
      prevOsFullscreen = isFs;
      setSnapshot({ isMaximized: max, isFullscreen: isFs });
    } catch {
      // ignore
    }
    try {
      // 单例 store 常驻，监听挂在模块生命周期上，不随组件卸载移除。
      await win.onResized(() => void syncFromResize(win));
    } catch {
      // ignore
    }
  })();
}

function subscribe(onStoreChange: () => void) {
  ensureStarted();
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

const getSnapshot = () => snapshot;

// —— Actions ——

/** 最小化窗口 */
async function minimizeWindow() {
  if (!isWindowsPlatformActive()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().minimize();
  } catch {
    // ignore
  }
}

/** 关闭窗口 */
async function closeWindow() {
  if (!isWindowsPlatformActive()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  } catch {
    // ignore
  }
}

function isWindowsPlatformActive() {
  return snapshot.isWindows;
}

/**
 * 最大化/还原。若当前正处在 OS 全屏，先退出全屏再最大化（反之亦然），并记下“之前是全屏”，
 * 使随后的“还原”回到全屏而非普通窗口。
 * @param peer 由调用方（播放器）提供的元素全屏进出能力；纯窗口层调用可省略。
 */
async function toggleMaximizeWindow(peer?: FullscreenPeer) {
  if (!snapshot.isWindows) return;
  let win: any = null;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    win = getCurrentWindow();
  } catch {
    // ignore
  }
  if (!win) return;

  let isFs = false;
  try {
    isFs = !!(await win.isFullscreen());
  } catch {
    isFs = false;
  }
  if (isFs) {
    // 全屏 → 最大化：先退出元素全屏（OS 原生全屏随之关闭）
    try {
      if (peer?.exitFullscreen) await peer.exitFullscreen();
    } catch {
      // ignore
    }
    await waitWindowFullscreenOff(win, 10);
    try {
      let stillFs = true;
      try {
        stillFs = !!(await win.isFullscreen());
      } catch {
        stillFs = false;
      }
      if (stillFs) await win.setFullscreen(false);
    } catch {
      // ignore
    }
    await waitWindowFullscreenOff(win);
    // 窗口已回落到“进入全屏前”的几何；若它本是最大化进入的，上面的 resize 恢复逻辑
    // 可能已代劳，重复 maximize 是幂等的。
    try {
      if (!(await win.isMaximized())) await win.maximize();
    } catch {
      // ignore
    }
    prevWasFullscreen = true;
    setSnapshot({ isMaximized: true });
    return;
  }

  let max = false;
  try {
    max = !!(await win.isMaximized());
  } catch {
    max = false;
  }
  if (max) {
    // “还原”：若这次最大化是从全屏切换来的，回到全屏而非普通窗口
    if (prevWasFullscreen) {
      prevWasFullscreen = false;
      try {
        await win.unmaximize();
      } catch {
        // ignore
      }
      try {
        if (peer?.getFullscreen) await peer.getFullscreen();
      } catch {
        // ignore
      }
      return;
    }
    try {
      await win.unmaximize();
    } catch {
      // ignore
    }
    setSnapshot({ isMaximized: false });
  } else {
    try {
      await win.maximize();
    } catch {
      // ignore
    }
    setSnapshot({ isMaximized: true });
  }
}

/**
 * 进入全屏前的准备：若窗口当前处于最大化，先 unmaximize 并记录，再放行元素全屏。
 * 由 xgplayer 的 getFullscreen 包装调用；退出全屏后的恢复由 syncFromResize 负责。
 */
async function prepareEnterFullscreen() {
  if (!snapshot.isWindows) return;
  let win: any = null;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    win = getCurrentWindow();
  } catch {
    // ignore
  }
  if (!win) return;
  let wasMax = false;
  try {
    wasMax = !!(await win.isMaximized());
  } catch {
    wasMax = false;
  }
  wasMaximizedBeforeFullscreen = wasMax;
  if (wasMax) {
    try {
      await win.unmaximize();
      setSnapshot({ isMaximized: false });
    } catch {
      // ignore
    }
  }
}

/** 元素全屏请求失败（如手势激活丢失）时撤销“之前最大化”记录，避免残留待恢复标记 */
function clearEnterFullscreenRecord() {
  wasMaximizedBeforeFullscreen = false;
}

export function useWindowState() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  return {
    // 状态
    isWindows: state.isWindows,
    isMaximized: state.isMaximized,
    isFullscreen: state.isFullscreen,
    // 动作（纯窗口层）
    minimizeWindow,
    toggleMaximizeWindow,
    closeWindow,
    // 动作（进入元素全屏前的协调，供 xgplayer getFullscreen 包装调用）
    prepareEnterFullscreen,
    clearEnterFullscreenRecord,
  };
}
