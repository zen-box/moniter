/*
 * Lightweight controls for the public pages. They replace HeroUI here so the
 * status page ships no component library, and every transition runs on
 * transform/opacity only.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Search, X } from "lucide-react";

type Option<T extends string> = {
  value: T;
  label: ReactNode;
  title?: string;
  count?: number;
};

/** Keeps an absolutely positioned indicator over the selected child. */
function useIndicator(value: string) {
  const host = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => {
      const active = element.querySelector<HTMLElement>('[data-active="true"]');
      setBox(active ? { x: active.offsetLeft, w: active.offsetWidth } : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [value]);
  return { host, style: box ? { transform: `translateX(${box.x}px)`, width: box.w } : { opacity: 0 } };
}

function arrowNavigation<T extends string>(
  event: KeyboardEvent,
  options: Option<T>[],
  value: T,
  onChange: (value: T) => void,
) {
  const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  if (!step) return;
  event.preventDefault();
  // React clears currentTarget once the handler returns; keep the element.
  const host = event.currentTarget as HTMLElement;
  const index = options.findIndex((option) => option.value === value);
  const next = options[(index + step + options.length) % options.length];
  onChange(next.value);
  requestAnimationFrame(() => host.querySelector<HTMLElement>('[data-active="true"]')?.focus());
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className = "",
}: {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const indicator = useIndicator(value);
  return (
    <div
      ref={indicator.host}
      className={`mp-segmented ${className}`}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(event) => arrowNavigation(event, options, value, onChange)}
    >
      <i className="mp-segmented-indicator" style={indicator.style} aria-hidden="true" />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          aria-label={option.title}
          title={option.title}
          tabIndex={option.value === value ? 0 : -1}
          data-active={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && <b>{option.count}</b>}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  label: string;
}) {
  const indicator = useIndicator(value);
  return (
    <div
      ref={indicator.host}
      className="mp-tabs"
      role="tablist"
      aria-label={label}
      onKeyDown={(event) => arrowNavigation(event, options, value, onChange)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          data-active={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && <b>{option.count}</b>}
        </button>
      ))}
      <i className="mp-tabs-indicator" style={indicator.style} aria-hidden="true" />
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  clearLabel = "Clear",
  shortcut = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  clearLabel?: string;
  shortcut?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!shortcut) return;
    const focus = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey ||
        /input|textarea|select/i.test(target.tagName) || target.isContentEditable) return;
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, [shortcut]);
  return (
    <label className="mp-search-field">
      <Search size={16} aria-hidden="true" />
      <input
        ref={input}
        type="search"
        value={value}
        aria-label={label}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            onChange("");
          }
        }}
      />
      {value ? (
        <button type="button" aria-label={clearLabel} onClick={() => { onChange(""); input.current?.focus(); }}>
          <X size={14} />
        </button>
      ) : shortcut ? (
        <kbd aria-hidden="true">/</kbd>
      ) : null}
    </label>
  );
}

/** Native dialog: real focus trapping and Escape handling, animated with CSS. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide = false,
  closeLabel = "Close",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
  closeLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open) {
      if (!element.open) element.showModal();
      element.dataset.state = "open";
      return;
    }
    if (!element.open) return;
    element.dataset.state = "closing";
    const timer = window.setTimeout(() => {
      element.close();
      setMounted(false);
    }, 170);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);
  if (!mounted) return null;
  return (
    <dialog
      ref={dialog}
      className={`mp-dialog ${wide ? "is-wide" : ""}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="mp-dialog-panel">
        <header>
          <h2>{title}</h2>
          <button type="button" className="mp-icon-button" aria-label={closeLabel} onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="mp-dialog-body">{children}</div>
      </div>
    </dialog>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="mp-tag">{children}</span>;
}
