import biliCategories from '../../data/categories/bilibili_categories.json';
import type { Category1, Category2 } from '@/platforms/common/categoryTypes';

// B 站直播分区（bilibili_categories.json）比通用 Category1/Category2 多带 id / parent_id，
// 房间列表接口反查（resolvedSubcategoryId / resolvedParentCategoryId）依赖它们。
export interface BilibiliCategory2 extends Category2 {
  id: string;
  parent_id: string;
}

export interface BilibiliCategory1 extends Category1 {
  id: number;
  subcategories: BilibiliCategory2[];
}

// 过滤掉包含“帮我玩”的一级分类（及其子分类）
export const biliCategoriesData: BilibiliCategory1[] = biliCategories.filter(
  (c1) => {
    const title: string = c1?.title ?? '';
    return !title.includes('帮我玩');
  },
);
