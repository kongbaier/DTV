import React, { Suspense, lazy } from 'react';
import { useSearchParams } from 'react-router-dom';

import { LoadingDots } from '@/components/common/LoadingDots';

const PlayerPage = lazy(() =>
  import('@/screens/PlayerPage').then((m) => ({ default: m.PlayerPage })),
);

export function PlayerRoute() {
  const [searchParams] = useSearchParams();
  const platform = (searchParams.get('platform') || 'douyu').toLowerCase();
  const roomId = searchParams.get('roomId') || '';

  if (!roomId) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          flex: 1,
          minHeight: 0,
          color: 'var(--secondary-text)',
          fontWeight: 700,
        }}
      >
        <div>
          <div style={{ fontSize: 16, marginBottom: 8 }}>未指定房间 ID</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            请从主播列表进入直播间
          </div>
        </div>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            flex: 1,
            minHeight: 0,
          }}
        >
          <LoadingDots />
        </div>
      }
    >
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <PlayerPage platform={platform} roomId={roomId} />
      </div>
    </Suspense>
  );
}
