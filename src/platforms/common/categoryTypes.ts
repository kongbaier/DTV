// 分类树节点。title / href 是四个平台公共的展示字段；
// id / parent_id 只有部分平台数据带（虎牙子分类 id、B 站一级+二级 id 与 parent_id），
// 抖音没有（靠 href 推导分区）、斗鱼走独立的 douyuCategory prop，所以全部标为可选。
// 反查平台分类 id 的逻辑见 CommonStreamerList.resolvedSubcategoryId / resolvedParentCategoryId。
export type CategoryId = string | number;

export interface Category1 {
  title: string;
  href: string;
  /** 一级分类 id —— 仅 B 站 JSON 提供（数字） */
  id?: number;
  subcategories: Category2[];
}

export interface Category2 {
  title: string;
  href: string;
  /** 二级分类 id —— 虎牙 / B 站提供 */
  id?: CategoryId;
  /** B 站二级分类带 parent_id，反查父分类 id 用 */
  parent_id?: CategoryId;
}

export interface CategorySelectedEvent {
  type: 'cate2';
  cate1Href: string;
  cate2Href: string;
  cate1Name: string;
  cate2Name: string;
}
