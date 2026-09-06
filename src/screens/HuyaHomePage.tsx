'use client';

import React, { useMemo, useState } from 'react';
import { m } from 'framer-motion';

import { CommonCategory } from '@/components/categories/CommonCategory';
import { CommonStreamerList } from '@/components/streamers/CommonStreamerList';
import { huyaCategoriesData } from '@/platforms/huya/huyaCategoriesData';
import type { CategorySelectedEvent } from '@/platforms/common/categoryTypes';
import { useCustomCategories } from '@/state/customCategories/CustomCategoriesProvider';

export function HuyaHomePage() {
  const [selected, setSelected] = useState<CategorySelectedEvent | null>(null);
  const custom = useCustomCategories();

  const canSubscribe = !!selected?.cate2Href;
  const isSubscribed = useMemo(() => {
    const href = selected?.cate2Href;
    return !!href && custom.isSubscribed('huya', href);
  }, [custom, selected?.cate2Href]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-transparent">
      <div className="z-10 shrink-0 bg-transparent">
        <CommonCategory
          categoriesData={huyaCategoriesData}
          onCategorySelected={(e) => setSelected(e)}
          actions={
            <m.button
              type="button"
              className="category-subscribe-btn"
              disabled={!canSubscribe}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                if (!selected?.cate2Href) return;
                const href = selected.cate2Href;
                if (custom.isSubscribed('huya', href))
                  custom.removeByKey(`huya:${href}`);
                else
                  custom.addCommonCate2(
                    'huya',
                    href,
                    selected.cate2Name,
                    selected.cate1Name,
                    selected.cate1Href,
                  );
              }}
            >
              {isSubscribed ? '取消订阅' : '订阅分区'}
            </m.button>
          }
        />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-transparent">
        <CommonStreamerList
          key={selected?.cate2Href ?? 'none'}
          selectedCategory={selected}
          categoriesData={huyaCategoriesData}
          defaultPageSize={120}
          platformName="huya"
        />
      </div>
    </div>
  );
}
