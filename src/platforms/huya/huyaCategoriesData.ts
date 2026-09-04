import huyaGames from '../../data/categories/huya_categories.json';
import type { Category1, Category2 } from '@/platforms/common/categoryTypes';

// 虎牙直播分区（huya_categories.json）：子分类带 id（请求接口用），一级分类不带 id。
export interface HuyaCategory2 extends Category2 {
  id: string;
}

export interface HuyaCategory1 extends Category1 {
  subcategories: HuyaCategory2[];
}

export const huyaCategoriesData: HuyaCategory1[] = huyaGames;
