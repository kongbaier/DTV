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
      <div className="flex flex-1 min-h-0 items-center justify-center text-muted-foreground font-bold">
        <div>
          <div className="text-[16px] mb-2">未指定房间 ID</div>
          <div className="text-[12px] opacity-70">请从主播列表进入直播间</div>
        </div>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex flex-1 min-h-0 items-center justify-center">
          <LoadingDots />
        </div>
      }
    >
      <div className="flex flex-1 min-h-0">
        <PlayerPage platform={platform} roomId={roomId} />
      </div>
    </Suspense>
  );
}
