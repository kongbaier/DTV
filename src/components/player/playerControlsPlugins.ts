import Plugin, { POSITIONS } from 'xgplayer/es/plugin/plugin.js';

import { ICONS, persistStoredMuted, persistStoredVolume } from './constants';

export class VolumeControl extends Plugin {
  static override pluginName = 'volumeControl';
  static override defaultConfig = {
    position: POSITIONS.CONTROLS_LEFT,
    index: 3,
    disable: false,
  };

  private volumeIcon: HTMLElement | null = null;
  private slider: HTMLInputElement | null = null;
  private valueLabel: HTMLElement | null = null;
  private onVolumeChange: ((value: number) => void) | null = null;
  private handleIconClick: ((event: Event) => void) | null = null;
  private previousVolume = 1;

  override render() {
    if (this.config.disable) {
      return '';
    }
    return `<xg-icon class="xgplayer-volume-control xgplayer-personal-control">
      <div class="volume-icon">
        ${ICONS.volume2}
      </div>
      <input class="volume-slider" type="range" min="0" max="100" step="1" value="100">
      <span class="volume-value">100%</span>
    </xg-icon>`;
  }

  override afterCreate() {
    if (this.config.disable) {
      return;
    }
    this.volumeIcon = this.find('.volume-icon') as HTMLElement | null;
    this.slider = this.find('.volume-slider') as HTMLInputElement | null;
    this.valueLabel = this.find('.volume-value') as HTMLElement | null;

    // 纯渲染:把当前 (volume, muted) 对齐到 UI,不改任何状态。
    // 静音或 0 音量都显示 volume-x(无声),否则显示正常音量 icon。
    const updateUI = (volume: number, muted: boolean) => {
      const clamped = Math.max(0, Math.min(1, volume));
      const silent = muted || clamped <= 0;
      if (this.slider) {
        this.slider.value = String(Math.round(clamped * 100));
        this.updateSliderVisual(this.slider);
      }
      if (this.valueLabel) {
        this.valueLabel.textContent = `${Math.round(clamped * 100)}%`;
      }
      if (this.volumeIcon) {
        this.volumeIcon.innerHTML = silent ? ICONS.volumeX : ICONS.volume2;
        this.volumeIcon.setAttribute('data-muted', muted ? 'true' : 'false');
        this.volumeIcon.setAttribute('title', silent ? '恢复音量' : '静音');
      }
    };

    // 初始化:usePlayerEngine 已把持久化音量写进 options.volume、并在构造后同步 player.muted,
    // 这里只需读播放器实际状态对齐 UI 并记住最后非零音量(供 0 音量点击恢复)。
    const initialVolume = this.player.volume ?? 0.6;
    const initialMuted = !!this.player.muted;
    if (initialVolume > 0) {
      this.previousVolume = initialVolume;
    }
    updateUI(initialVolume, initialMuted);

    this.slider?.addEventListener('input', (event) => {
      const value = Number((event.target as HTMLInputElement).value);
      const clampedPercent = Math.max(0, Math.min(100, value));
      const normalized = clampedPercent / 100;
      if (normalized > 0) {
        this.previousVolume = normalized;
      }
      // 拖动滑条即表达“以该音量出声”:音量>0 时解除静音;拖到 0 保持非静音(0 音量 ≠ 静音)。
      if (this.player.muted && normalized > 0) {
        this.player.muted = false;
      }
      this.player.volume = normalized;
      persistStoredVolume(normalized);
      updateUI(normalized, this.player.muted);
    });

    this.handleIconClick = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      const currentVolume = this.player.volume ?? 0;
      if (!this.player.muted && currentVolume > 0) {
        // 有声 → 静音:只切 muted,保留 volume(两个轴分离),取消静音时回到该音量。
        this.player.muted = true;
      } else {
        // 静音中(恢复原音量)或 0 音量(恢复到记忆音量) → 出声。
        const remembered = this.previousVolume > 0 ? this.previousVolume : 1;
        const restore =
          this.player.muted && currentVolume > 0 ? currentVolume : remembered;
        this.player.volume = restore;
        if (restore > 0) {
          this.previousVolume = restore;
        }
        this.player.muted = false;
      }
      persistStoredVolume(this.player.volume ?? 0);
      persistStoredMuted(this.player.muted);
      updateUI(this.player.volume ?? 0, this.player.muted);
    };

    this.volumeIcon?.addEventListener('click', this.handleIconClick);
    if (this.volumeIcon) {
      this.volumeIcon.style.cursor = 'pointer';
    }

    this.onVolumeChange = () => {
      const volume = this.player.volume ?? 0;
      const muted = !!this.player.muted;
      if (volume > 0) {
        this.previousVolume = volume;
      }
      updateUI(volume, muted);
      persistStoredVolume(volume);
      persistStoredMuted(muted);
    };
    this.player.on('volumechange', this.onVolumeChange);
  }

  override destroy() {
    if (this.handleIconClick && this.volumeIcon) {
      this.volumeIcon.removeEventListener('click', this.handleIconClick);
      this.handleIconClick = null;
    }
    if (this.onVolumeChange) {
      this.player.off('volumechange', this.onVolumeChange);
      this.onVolumeChange = null;
    }
    this.volumeIcon = null;
    this.slider = null;
    this.valueLabel = null;
  }

  private updateSliderVisual(el: HTMLInputElement | null) {
    if (!el) {
      return;
    }
    const value = Number(el.value);
    const percent = Math.max(0, Math.min(100, value));
    el.style.background = `linear-gradient(90deg, var(--player-accent) ${percent}%, rgba(255, 255, 255, 0.15) ${percent}%)`;
  }
}

export class RefreshControl extends Plugin {
  static override pluginName = 'refreshControl';
  static override defaultConfig = {
    position: POSITIONS.CONTROLS_LEFT,
    index: 2,
    disable: false,
    onClick: null as (() => void) | null,
  };

  private handleClick: ((event: Event) => void) | null = null;
  private isLoading = false;

  override afterCreate() {
    if (this.config.disable) {
      return;
    }
    this.handleClick = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.isLoading) {
        return;
      }
      if (typeof this.config.onClick === 'function') {
        this.config.onClick();
      }
    };
    this.bind(['click', 'touchend'], this.handleClick);
  }

  override destroy() {
    if (this.handleClick) {
      this.unbind(['click', 'touchend'], this.handleClick);
      this.handleClick = null;
    }
    this.setLoading(false);
  }

  override render() {
    if (this.config.disable) {
      return '';
    }
    return `<xg-icon class="xgplayer-refresh-control xgplayer-personal-control" title="刷新">
      ${ICONS.rotateCcw}
    </xg-icon>`;
  }

  setLoading(isLoading: boolean) {
    this.isLoading = isLoading;
    const root = this.root as HTMLElement | null;
    if (!root) {
      return;
    }
    root.classList.toggle('is-loading', isLoading);
    if (isLoading) {
      root.setAttribute('aria-disabled', 'true');
    } else {
      root.removeAttribute('aria-disabled');
    }
  }
}

export class QualityControl extends Plugin {
  static override pluginName = 'qualityControl';
  static override defaultConfig = {
    position: POSITIONS.CONTROLS_RIGHT,
    index: 5,
    disable: false,
    options: [] as string[],
    getCurrent: (() => '') as () => string,
    onSelect: (async (_value: string) => {}) as (
      value: string,
    ) => Promise<void> | void,
  };

  private dropdown: HTMLElement | null = null;
  private handleToggle: ((event: Event) => void) | null = null;
  private handleDocumentClick: ((event: MouseEvent) => void) | null = null;
  private handleHoverEnter: ((event: Event) => void) | null = null;
  private handleHoverLeave: ((event: Event) => void) | null = null;
  private hoverCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private isSwitching = false;

  override afterCreate() {
    if (this.config.disable) {
      return;
    }

    this.createDropdown();
    this.updateLabel(this.getCurrent());

    this.handleToggle = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.isSwitching) {
        return;
      }
      this.toggleDropdown();
    };
    this.bind(['click', 'touchend'], this.handleToggle);

    if (typeof document !== 'undefined') {
      this.handleDocumentClick = (event: MouseEvent) => {
        if (!this.root.contains(event.target as Node)) {
          this.hideDropdown();
        }
      };
      document.addEventListener('click', this.handleDocumentClick);
    }

    this.handleHoverEnter = () => {
      if (this.hoverCloseTimer) {
        clearTimeout(this.hoverCloseTimer);
        this.hoverCloseTimer = null;
      }
      if (!this.isSwitching) {
        this.openDropdown();
      }
    };
    this.handleHoverLeave = () => {
      if (this.hoverCloseTimer) {
        clearTimeout(this.hoverCloseTimer);
      }
      this.hoverCloseTimer = setTimeout(() => {
        this.hoverCloseTimer = null;
        this.hideDropdown();
      }, 220);
    };
    this.bind('mouseenter', this.handleHoverEnter);
    this.bind('mouseleave', this.handleHoverLeave);
  }

  override destroy() {
    if (this.handleToggle) {
      this.unbind(['click', 'touchend'], this.handleToggle);
      this.handleToggle = null;
    }
    if (this.handleDocumentClick) {
      document.removeEventListener('click', this.handleDocumentClick);
      this.handleDocumentClick = null;
    }
    if (this.handleHoverEnter) {
      this.unbind('mouseenter', this.handleHoverEnter);
      this.handleHoverEnter = null;
    }
    if (this.handleHoverLeave) {
      this.unbind('mouseleave', this.handleHoverLeave);
      this.handleHoverLeave = null;
    }
    if (this.hoverCloseTimer) {
      clearTimeout(this.hoverCloseTimer);
      this.hoverCloseTimer = null;
    }
    if (this.dropdown) {
      this.dropdown.remove();
      this.dropdown = null;
    }
    this.setSwitching(false);
  }

  override render() {
    if (this.config.disable) {
      return '';
    }
    const current = this.getCurrent();
    return `<xg-icon class="xgplayer-quality-control xgplayer-personal-control" title="">
      <span class="quality-label">${current}</span>
      <svg class="quality-caret" width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M2.5 3.5L5 6l2.5-2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </xg-icon>`;
  }

  updateLabel(label: string) {
    const textEl = this.find('.quality-label') as HTMLElement | null;
    if (textEl) {
      textEl.textContent = label;
    }
    this.updateActiveState(label);
  }

  setOptions(options: string[]) {
    this.config.options = options;
    this.populateDropdown();
  }

  private getCurrent() {
    return typeof this.config.getCurrent === 'function'
      ? this.config.getCurrent()
      : '';
  }

  private createDropdown() {
    this.dropdown = document.createElement('div');
    this.dropdown.className = 'xgplayer-quality-dropdown';
    this.root.appendChild(this.dropdown);
    this.populateDropdown();
  }

  private populateDropdown() {
    if (!this.dropdown) {
      return;
    }
    this.dropdown.innerHTML = '';
    const options: string[] = Array.isArray(this.config.options)
      ? this.config.options
      : [];
    options.forEach((option) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'xgplayer-quality-item';
      btn.innerHTML = `
        <span class="quality-name">${option}</span>
        <svg class="quality-check" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 6.5l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        event.preventDefault();
        if (this.isSwitching) {
          return;
        }
        let actionResult: Promise<void> | void;
        try {
          const callback = this.config.onSelect;
          actionResult =
            typeof callback === 'function' ? callback(option) : undefined;
        } catch (error) {
          console.error('[QualityControl] onSelect error:', error);
          actionResult = undefined;
        }
        Promise.resolve(actionResult).finally(() => {
          this.hideDropdown();
          this.updateLabel(this.getCurrent());
        });
      });
      this.dropdown!.appendChild(btn);
    });
    this.updateActiveState(this.getCurrent());
    this.applySwitchingState();
  }

  private toggleDropdown() {
    if (this.isSwitching) {
      return;
    }
    if (this.dropdown?.classList.contains('show')) {
      this.hideDropdown();
    } else {
      this.openDropdown();
    }
  }

  private openDropdown() {
    if (this.isSwitching || !this.dropdown) {
      return;
    }
    if (this.hoverCloseTimer) {
      clearTimeout(this.hoverCloseTimer);
      this.hoverCloseTimer = null;
    }
    this.dropdown.classList.add('show');
    this.root.classList.add('menu-open');
    this.updateActiveState(this.getCurrent());
  }

  private hideDropdown() {
    if (this.hoverCloseTimer) {
      clearTimeout(this.hoverCloseTimer);
      this.hoverCloseTimer = null;
    }
    if (this.dropdown) {
      this.dropdown.classList.remove('show');
    }
    this.root.classList.remove('menu-open');
  }

  private updateActiveState(current: string) {
    if (!this.dropdown) {
      return;
    }
    const items = this.dropdown.querySelectorAll<HTMLButtonElement>(
      '.xgplayer-quality-item',
    );
    items.forEach((item) => {
      const label = item.querySelector('.quality-name')?.textContent?.trim();
      item.classList.toggle('active', label === current);
    });
  }

  setSwitching(isSwitching: boolean) {
    this.isSwitching = isSwitching;
    this.applySwitchingState();
    if (isSwitching) {
      this.hideDropdown();
    }
  }

  private applySwitchingState() {
    const root = this.root as HTMLElement | null;
    if (root) {
      root.classList.toggle('is-switching', this.isSwitching);
    }
    if (this.dropdown) {
      this.dropdown.classList.toggle('disabled', this.isSwitching);
      const buttons = this.dropdown.querySelectorAll<HTMLButtonElement>(
        '.xgplayer-quality-item',
      );
      buttons.forEach((button) => {
        button.disabled = this.isSwitching;
      });
    }
  }
}

export interface LineOption {
  key: string;
  label: string;
}

export class LineControl extends Plugin {
  static override pluginName = 'lineControl';
  static override defaultConfig = {
    position: POSITIONS.CONTROLS_RIGHT,
    index: 5.2,
    disable: false,
    options: [] as LineOption[],
    getCurrentKey: (() => '') as () => string,
    getCurrentLabel: (() => '线路') as () => string,
    onSelect: (async (_value: string) => {}) as (
      value: string,
    ) => Promise<void> | void,
  };

  private dropdown: HTMLElement | null = null;
  private handleToggle: ((event: Event) => void) | null = null;
  private handleDocumentClick: ((event: MouseEvent) => void) | null = null;
  private handleHoverEnter: ((event: Event) => void) | null = null;
  private handleHoverLeave: ((event: Event) => void) | null = null;
  private hoverCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private isSwitching = false;

  override afterCreate() {
    if (this.config.disable) {
      this.updateVisibility();
      return;
    }

    this.createDropdown();
    this.updateLabel(this.getCurrentLabel());
    this.updateVisibility();

    this.handleToggle = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.isSwitching) {
        return;
      }
      this.toggleDropdown();
    };
    this.bind(['click', 'touchend'], this.handleToggle);

    if (typeof document !== 'undefined') {
      this.handleDocumentClick = (event: MouseEvent) => {
        if (!this.root.contains(event.target as Node)) {
          this.hideDropdown();
        }
      };
      document.addEventListener('click', this.handleDocumentClick);
    }

    this.handleHoverEnter = () => {
      if (this.hoverCloseTimer) {
        clearTimeout(this.hoverCloseTimer);
        this.hoverCloseTimer = null;
      }
      if (!this.isSwitching) {
        this.openDropdown();
      }
    };
    this.handleHoverLeave = () => {
      if (this.hoverCloseTimer) {
        clearTimeout(this.hoverCloseTimer);
      }
      this.hoverCloseTimer = setTimeout(() => {
        this.hoverCloseTimer = null;
        this.hideDropdown();
      }, 220);
    };
    this.bind('mouseenter', this.handleHoverEnter);
    this.bind('mouseleave', this.handleHoverLeave);
  }

  override destroy() {
    if (this.handleToggle) {
      this.unbind(['click', 'touchend'], this.handleToggle);
      this.handleToggle = null;
    }
    if (this.handleDocumentClick) {
      document.removeEventListener('click', this.handleDocumentClick);
      this.handleDocumentClick = null;
    }
    if (this.handleHoverEnter) {
      this.unbind('mouseenter', this.handleHoverEnter);
      this.handleHoverEnter = null;
    }
    if (this.handleHoverLeave) {
      this.unbind('mouseleave', this.handleHoverLeave);
      this.handleHoverLeave = null;
    }
    if (this.hoverCloseTimer) {
      clearTimeout(this.hoverCloseTimer);
      this.hoverCloseTimer = null;
    }
    if (this.dropdown) {
      this.dropdown.remove();
      this.dropdown = null;
    }
    this.setSwitching(false);
  }

  override render() {
    if (this.config.disable) {
      return '';
    }
    const current = this.getCurrentLabel();
    return `<xg-icon class="xgplayer-line-control xgplayer-personal-control" title="">
      <span class="line-label">${current || '线路'}</span>
      <svg class="line-caret" width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M2.5 3.5L5 6l2.5-2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </xg-icon>`;
  }

  updateLabel(label: string) {
    const textEl = this.find('.line-label') as HTMLElement | null;
    if (textEl) {
      textEl.textContent = label || '线路';
    }
    this.updateActiveState(this.getCurrentKey());
  }

  setOptions(options: LineOption[]) {
    this.config.options = Array.isArray(options) ? [...options] : [];
    this.populateDropdown();
    this.updateVisibility();
  }

  setSwitching(isSwitching: boolean) {
    this.isSwitching = isSwitching;
    this.applySwitchingState();
    if (isSwitching) {
      this.hideDropdown();
    }
  }

  private getCurrentKey() {
    return typeof this.config.getCurrentKey === 'function'
      ? this.config.getCurrentKey()
      : '';
  }

  private getCurrentLabel() {
    return typeof this.config.getCurrentLabel === 'function'
      ? this.config.getCurrentLabel()
      : '线路';
  }

  private createDropdown() {
    this.dropdown = document.createElement('div');
    this.dropdown.className = 'xgplayer-line-dropdown';
    this.root.appendChild(this.dropdown);
    this.populateDropdown();
  }

  private populateDropdown() {
    if (!this.dropdown) {
      return;
    }
    this.dropdown.innerHTML = '';
    const options: LineOption[] = Array.isArray(this.config.options)
      ? this.config.options
      : [];
    options.forEach((option) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'xgplayer-quality-item';
      btn.dataset.lineKey = option.key;
      btn.innerHTML = `
        <span class="quality-name">${option.label}</span>
        <svg class="quality-check" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 6.5l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        event.preventDefault();
        if (this.isSwitching) {
          return;
        }
        let actionResult: Promise<void> | void;
        try {
          const callback = this.config.onSelect;
          actionResult =
            typeof callback === 'function' ? callback(option.key) : undefined;
        } catch (error) {
          console.error('[LineControl] onSelect error:', error);
          actionResult = undefined;
        }
        Promise.resolve(actionResult).finally(() => {
          this.hideDropdown();
          this.updateLabel(this.getCurrentLabel());
        });
      });
      this.dropdown!.appendChild(btn);
    });
    this.updateActiveState(this.getCurrentKey());
    this.applySwitchingState();
  }

  private toggleDropdown() {
    if (this.isSwitching) {
      return;
    }
    if (this.dropdown?.classList.contains('show')) {
      this.hideDropdown();
    } else {
      this.openDropdown();
    }
  }

  private openDropdown() {
    if (this.isSwitching || !this.dropdown) {
      return;
    }
    if (this.hoverCloseTimer) {
      clearTimeout(this.hoverCloseTimer);
      this.hoverCloseTimer = null;
    }
    this.dropdown.classList.add('show');
    this.root.classList.add('menu-open');
    this.updateActiveState(this.getCurrentKey());
  }

  private hideDropdown() {
    if (this.hoverCloseTimer) {
      clearTimeout(this.hoverCloseTimer);
      this.hoverCloseTimer = null;
    }
    if (this.dropdown) {
      this.dropdown.classList.remove('show');
    }
    this.root.classList.remove('menu-open');
  }

  private updateActiveState(currentKey: string) {
    if (!this.dropdown) {
      return;
    }
    const items = this.dropdown.querySelectorAll<HTMLButtonElement>(
      '.xgplayer-quality-item',
    );
    items.forEach((item) => {
      const key = item.dataset.lineKey ?? '';
      item.classList.toggle('active', key === currentKey);
    });
  }

  private applySwitchingState() {
    const root = this.root as HTMLElement | null;
    if (root) {
      root.classList.toggle('is-switching', this.isSwitching);
    }
    if (this.dropdown) {
      this.dropdown.classList.toggle('disabled', this.isSwitching);
      const buttons = this.dropdown.querySelectorAll<HTMLButtonElement>(
        '.xgplayer-quality-item',
      );
      buttons.forEach((button) => {
        button.disabled = this.isSwitching;
      });
    }
  }

  private updateVisibility() {
    const root = this.root as HTMLElement | null;
    if (!root) {
      return;
    }
    const options: LineOption[] = Array.isArray(this.config.options)
      ? this.config.options
      : [];
    root.style.display = options.length === 0 ? 'none' : '';
  }
}
