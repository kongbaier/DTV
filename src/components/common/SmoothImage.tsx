'use client';

import React, { memo, useState } from 'react';
import styles from './SmoothImage.module.css';

function SmoothImageInner({
  src,
  alt,
  className,
  loading,
}: {
  src: string;
  alt?: string;
  className?: string;
  loading?: 'eager' | 'lazy';
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  return (
    <>
      {!loaded && !error ? <div className={styles.placeholder} /> : null}
      {error ? (
        <div className={styles.error} aria-hidden="true">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={styles.errorIcon}
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={`${styles.img} ${loaded ? styles.imgLoaded : ''} ${className ?? ''}`}
        src={src}
        alt={alt ?? ''}
        loading={loading ?? 'lazy'}
        decoding="async"
        draggable={false}
        onLoad={() => {
          setLoaded(true);
          setError(false);
        }}
        onError={() => {
          setLoaded(false);
          setError(true);
        }}
        ref={(node) => {
          if (!node) return;
          if (!loaded && !error && node.complete && node.naturalWidth > 0) {
            setLoaded(true);
          }
        }}
      />
    </>
  );
}

export const SmoothImage = memo(function SmoothImage({
  src,
  alt,
  className,
  loading,
}: {
  src: string;
  alt?: string;
  className?: string;
  loading?: 'eager' | 'lazy';
}) {
  return (
    <div className={styles.wrapper}>
      {/* src 变化时通过 key 重挂载内层，加载状态随实例自然重置，
          无需在 effect 里同步 setState；className 等变化则保留加载状态。 */}
      <SmoothImageInner
        key={src}
        src={src}
        alt={alt}
        className={className}
        loading={loading}
      />
    </div>
  );
});
