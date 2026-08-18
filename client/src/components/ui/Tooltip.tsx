import React, { useState, useRef, useEffect } from 'react';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  /** Where the tooltip appears relative to the trigger. Defaults to 'bottom'. */
  placement?: 'top' | 'bottom';
  /** Max width of the tooltip card in pixels. Defaults to 320. */
  maxWidth?: number;
}

/**
 * A polished hover tooltip that renders a styled popover card above or below
 * the trigger element. Uses CSS variables so it automatically adapts to any
 * active theme.
 */
export function Tooltip({ content, children, placement = 'bottom', maxWidth = 320 }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, arrowLeft: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  function reposition() {
    if (!triggerRef.current || !tooltipRef.current) return;
    const trigger = triggerRef.current.getBoundingClientRect();
    const tip = tooltipRef.current.getBoundingClientRect();
    const gap = 10;

    // Clamp horizontal position so card never overflows the viewport
    let left = trigger.left + trigger.width / 2 - tip.width / 2;
    const minLeft = 8;
    const maxLeft = window.innerWidth - tip.width - 8;
    left = Math.max(minLeft, Math.min(left, maxLeft));

    const arrowLeft = trigger.left + trigger.width / 2 - left;

    let top: number;
    if (placement === 'top') {
      top = trigger.top - tip.height - gap + window.scrollY;
    } else {
      top = trigger.bottom + gap + window.scrollY;
    }

    setCoords({ top, left, arrowLeft });
  }

  useEffect(() => {
    if (visible) {
      requestAnimationFrame(reposition);
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}

      {visible && (
        <div
          ref={tooltipRef}
          role="tooltip"
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            maxWidth,
            zIndex: 9999,
          }}
          className="tooltip-card"
        >
          {/* Arrow pointer */}
          <div
            className={`tooltip-arrow tooltip-arrow--${placement}`}
            style={{ left: coords.arrowLeft }}
          />
          {content}
        </div>
      )}

      <style>{`
        .tooltip-card {
          background: var(--color-surface-raised, #1e2235);
          border: 1px solid var(--color-border, rgba(255,255,255,0.1));
          border-radius: 10px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.18);
          padding: 12px 16px;
          font-size: 13px;
          line-height: 1.55;
          color: var(--color-text-secondary, #b0b8d4);
          animation: tooltip-fadein 0.14s ease;
          pointer-events: none;
          backdrop-filter: blur(12px);
          white-space: normal;
          text-align: left;
        }
        @keyframes tooltip-fadein {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .tooltip-arrow {
          position: absolute;
          width: 10px;
          height: 10px;
          background: var(--color-surface-raised, #1e2235);
          border: 1px solid var(--color-border, rgba(255,255,255,0.1));
          transform: translateX(-50%) rotate(45deg);
        }
        .tooltip-arrow--bottom {
          top: -6px;
          border-bottom: none;
          border-right: none;
        }
        .tooltip-arrow--top {
          bottom: -6px;
          border-top: none;
          border-left: none;
        }
      `}</style>
    </div>
  );
}
