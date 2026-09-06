'use client';

import React from 'react';
import { FollowsList } from '@/components/follows/FollowsList';

export function Sidebar({ isCollapsed }: { isCollapsed: boolean }) {
  return (
    <aside
      className="flex h-full flex-col border-r border-border bg-background"
      style={{
        width: isCollapsed
          ? 'var(--sidebar-collapsed-width)'
          : 'var(--sidebar-width)',
      }}
    >
      {!isCollapsed ? (
        <div className="min-h-0 flex-1">
          <FollowsList />
        </div>
      ) : null}
    </aside>
  );
}
