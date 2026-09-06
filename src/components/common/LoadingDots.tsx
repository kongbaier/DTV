'use client';

import React from 'react';

// 加载中三点动画：容器/圆点全用 Tailwind 类，dot-bounce 动画名见 base.css 全局 keyframes。
const dotClass =
  'size-[10px] rounded-full bg-[color-mix(in_srgb,var(--primary)_70%,var(--muted-foreground))] animate-[dot-bounce_1.1s_ease-in-out_infinite]';

export function LoadingDots() {
  return (
    <div
      className="inline-flex items-center gap-[10px]"
      role="status"
      aria-live="polite"
      aria-label="加载中"
    >
      <span className={dotClass} />
      <span className={`${dotClass} [animation-delay:0.15s]`} />
      <span className={`${dotClass} [animation-delay:0.3s]`} />
    </div>
  );
}
