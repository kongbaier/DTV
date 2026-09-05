'use client';

import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from 'lucide-react';
import { AnimatePresence, m } from 'framer-motion';

import styles from './CommonCategory.module.css';
import type {
  Category1,
  Category2,
  CategorySelectedEvent,
} from '@/platforms/common/categoryTypes';

export function CommonCategory({
  categoriesData,
  onCategorySelected,
  actions,
}: {
  categoriesData: Category1[];
  onCategorySelected: (event: CategorySelectedEvent) => void;
  actions?: React.ReactNode;
}) {
  const [cate1List, setCate1List] = useState<Category1[]>([]);

  const [selectedCate1Href, setSelectedCate1Href] = useState<string | null>(
    null,
  );
  const [selectedCate2Href, setSelectedCate2Href] = useState<string | null>(
    null,
  );
  const [expanded, setExpanded] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const cate2ShellRef = useRef<HTMLDivElement | null>(null);
  const [overlayMaxHeight, setOverlayMaxHeight] = useState<number | null>(null);
  const emittedKeyRef = useRef<string | null>(null);
  const cate1ListRef = useRef<HTMLUListElement | null>(null);
  // 列表是隐藏滚动条的横向滚动容器，可在对应方向滚动时浮出箭头提示
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);

  useEffect(() => {
    setCate1List(Array.isArray(categoriesData) ? categoriesData : []);
    setExpanded(false);
  }, [categoriesData]);

  useEffect(() => {
    const el = cate1ListRef.current;
    if (!el) {
      setCanScrollRight(false);
      setCanScrollLeft(false);
      return;
    }
    const update = () => {
      const node = cate1ListRef.current;
      if (!node) return;
      const { scrollLeft, clientWidth, scrollWidth } = node;
      setCanScrollRight(scrollWidth - scrollLeft - clientWidth > 2);
      setCanScrollLeft(scrollLeft > 2);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    // 布局/字体就绪后再补量一次，覆盖分类列表刚更新的情况
    const t = window.setTimeout(update, 300);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.clearTimeout(t);
    };
  }, [cate1List]);

  const scrollRight = () => {
    const el = cate1ListRef.current;
    if (!el) return;
    // 每次滚动约一屏的四分之三，至少 200px，避免几乎不可见的位移
    const step = Math.max(200, Math.round(el.clientWidth * 0.75));
    el.scrollTo({ left: el.scrollLeft + step, behavior: 'smooth' });
  };

  const scrollLeft = () => {
    const el = cate1ListRef.current;
    if (!el) return;
    // 与 scrollRight 同幅度回退
    const step = Math.max(200, Math.round(el.clientWidth * 0.75));
    el.scrollTo({
      left: Math.max(0, el.scrollLeft - step),
      behavior: 'smooth',
    });
  };

  useLayoutEffect(() => {
    if (!expanded) {
      setOverlayMaxHeight(null);
      return;
    }

    const update = () => {
      const anchor = cate2ShellRef.current;
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const top = r.bottom + 8; // align with .cate2Overlay margin-top
      const viewportH = window.innerHeight || 0;
      const maxH = Math.max(180, viewportH - top - 16);
      setOverlayMaxHeight(Number.isFinite(maxH) ? maxH : null);
    };

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', onScroll, true);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [expanded]);

  const currentCate2List = useMemo(() => {
    if (!selectedCate1Href) return [];
    const selected = cate1List.find((c1) => c1.href === selectedCate1Href);
    return selected?.subcategories ?? [];
  }, [cate1List, selectedCate1Href]);

  const emitCate2 = (cate2: Category2) => {
    setSelectedCate2Href(cate2.href);
    const selectedCate1 = cate1List.find((c1) => c1.href === selectedCate1Href);
    if (!selectedCate1) return;
    // 避免后续 effect 再次触发同一个选择事件（会导致重复请求）
    if (selectedCate1Href) {
      emittedKeyRef.current = `${selectedCate1Href}:${cate2.href}`;
    }
    onCategorySelected({
      type: 'cate2',
      cate1Href: selectedCate1.href,
      cate2Href: cate2.href,
      cate1Name: selectedCate1.title,
      cate2Name: cate2.title,
    });
  };

  useEffect(() => {
    if (cate1List.length === 0) return;
    if (!selectedCate1Href) {
      setSelectedCate1Href(cate1List[0].href);
      return;
    }
    if (!cate1List.some((x) => x.href === selectedCate1Href)) {
      setSelectedCate1Href(cate1List[0].href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cate1List, selectedCate1Href]);

  useEffect(() => {
    if (!selectedCate1Href) return;
    if (currentCate2List.length === 0) return;
    if (
      !selectedCate2Href ||
      !currentCate2List.some((x) => x.href === selectedCate2Href)
    ) {
      emitCate2(currentCate2List[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCate2List, selectedCate1Href]);

  useEffect(() => {
    if (!selectedCate1Href || !selectedCate2Href) return;
    const selectedCate1 = cate1List.find((c1) => c1.href === selectedCate1Href);
    const selectedCate2 = currentCate2List.find(
      (c2) => c2.href === selectedCate2Href,
    );
    if (!selectedCate1 || !selectedCate2) return;
    const key = `${selectedCate1Href}:${selectedCate2Href}`;
    if (emittedKeyRef.current === key) return;
    emittedKeyRef.current = key;
    onCategorySelected({
      type: 'cate2',
      cate1Href: selectedCate1.href,
      cate2Href: selectedCate2.href,
      cate1Name: selectedCate1.title,
      cate2Name: selectedCate2.title,
    });
  }, [
    cate1List,
    currentCate2List,
    onCategorySelected,
    selectedCate1Href,
    selectedCate2Href,
  ]);

  return (
    <div
      className={`${styles.categoryList} ${expanded ? styles.categoryListExpanded : ''}`}
    >
      {cate1List.length > 0 ? (
        <>
          <div className={styles.cate1ListContainer}>
            <div className={styles.cate1Row}>
              <div className={styles.cate1ListWrap}>
                {canScrollLeft ? (
                  <button
                    type="button"
                    className={
                      styles.cate1ScrollBtn + ' ' + styles.cate1ScrollLeft
                    }
                    onClick={scrollLeft}
                    title="回到前面的分类"
                    aria-label="回到前面的分类"
                  >
                    <ChevronLeft size={14} />
                  </button>
                ) : null}
                <ul ref={cate1ListRef} className={styles.cate1List}>
                  {cate1List.map((c1) => {
                    const selected = c1.href === selectedCate1Href;
                    return (
                      <li
                        key={c1.href}
                        className={`${styles.cate1Item} ${selected ? styles.cate1ItemSelected : ''}`}
                        onClick={() => {
                          if (selectedCate1Href === c1.href) return;
                          setSelectedCate1Href(c1.href);
                          setSelectedCate2Href(null);
                          setExpanded(false);
                        }}
                      >
                        {c1.title}
                      </li>
                    );
                  })}
                </ul>
                {canScrollRight ? (
                  <button
                    type="button"
                    className={
                      styles.cate1ScrollBtn + ' ' + styles.cate1ScrollRight
                    }
                    onClick={scrollRight}
                    title="查看更多分类"
                    aria-label="查看更多分类"
                  >
                    <ChevronRight size={14} />
                  </button>
                ) : null}
              </div>
              <div className={styles.cate1Actions}>{actions}</div>
            </div>
          </div>

          {currentCate2List.length > 0 ? (
            <div className={styles.cate2Container}>
              <div className={styles.cate2Shell} ref={cate2ShellRef}>
                <div className={styles.cate2Grid}>
                  {currentCate2List.slice(0, 9).map((c2) => {
                    const active = c2.href === selectedCate2Href;
                    return (
                      <button
                        key={c2.href}
                        type="button"
                        className={`${styles.cate2Card} ${active ? styles.cate2CardActive : ''}`}
                        aria-pressed={active}
                        onClick={() => {
                          emitCate2(c2);
                          setExpanded(false);
                        }}
                        aria-label={c2.title}
                        title={c2.title}
                      >
                        <div className={styles.cate2Name}>{c2.title}</div>
                      </button>
                    );
                  })}

                  {currentCate2List.length > 9 ? (
                    <button
                      type="button"
                      className={styles.cate2ExpandBtn}
                      onClick={() => {
                        setExpanded((v) => !v);
                      }}
                    >
                      {expanded ? (
                        <>
                          关闭 <ChevronUp size={14} />
                        </>
                      ) : (
                        <>
                          展开 <ChevronDown size={14} />
                        </>
                      )}
                    </button>
                  ) : null}
                </div>
              </div>

              <AnimatePresence>
                {currentCate2List.length > 9 && expanded ? (
                  <m.div
                    className={styles.cate2Overlay}
                    ref={overlayRef}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    style={
                      overlayMaxHeight
                        ? { maxHeight: overlayMaxHeight }
                        : undefined
                    }
                  >
                    <div className={styles.cate2OverlayBody}>
                      <div className={styles.cate2OverlayGrid}>
                        {currentCate2List.slice(9).map((c2) => {
                          const active = c2.href === selectedCate2Href;
                          return (
                            <button
                              key={`overlay_${c2.href}`}
                              type="button"
                              className={`${styles.cate2Card} ${active ? styles.cate2CardActive : ''}`}
                              aria-pressed={active}
                              onClick={() => {
                                emitCate2(c2);
                                setExpanded(false);
                              }}
                              aria-label={c2.title}
                              title={c2.title}
                            >
                              <div className={styles.cate2Name}>{c2.title}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </m.div>
                ) : null}
              </AnimatePresence>
            </div>
          ) : null}
        </>
      ) : (
        <div className={styles.loadingState}>
          <div className={styles.loadingText}>正在加载分类数据...</div>
        </div>
      )}
    </div>
  );
}
