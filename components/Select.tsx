"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

/**
 * The console's one dropdown.
 *
 * The native <select> rendered differently on every OS, could not be searched,
 * and a 64-district list was a scroll marathon. This is a button + listbox
 * combobox that still behaves like a form control: give it a `name` and it
 * writes a hidden input, so every FormData-based submit keeps working
 * unchanged.
 *
 * The list is portalled to <body> with fixed positioning — panels, tables and
 * sticky footers all clip or trap an absolutely positioned child sooner or
 * later — and opens upward when there is no room below.
 */

export type SelectOption = {
  value: string;
  label: string;
  /** Consecutive options with the same group render under one heading. */
  group?: string;
  disabled?: boolean;
};

/** Lookup rows (lib/admin-lookups) carry `id`; the picker speaks `value`. */
export function fromLookup(options: Array<{ id: string; label: string; group?: string }>): SelectOption[] {
  return options.map((option) => ({ value: option.id, label: option.label, group: option.group }));
}

/** Above this many options the list gets a search box. */
export const SEARCH_THRESHOLD = 8;

function fold(text: string) {
  // NFC first: Bangla typed on one keyboard and stored from another can differ
  // in composition and would otherwise never match.
  return text.normalize("NFC").toLocaleLowerCase();
}

/** Every word of the query must appear somewhere in the label or its group. */
export function matchesQuery(option: SelectOption, query: string) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = fold(`${option.label} ${option.group ?? ""}`);
  return words.every((word) => haystack.includes(word));
}

function nextEnabled(options: SelectOption[], from: number, step: 1 | -1) {
  if (!options.length) return -1;
  let index = from;
  for (let tries = 0; tries < options.length; tries += 1) {
    index += step;
    if (index < 0 || index >= options.length) return from;
    if (!options[index].disabled) return index;
  }
  return from;
}

function firstEnabled(options: SelectOption[]) {
  return options.findIndex((option) => !option.disabled);
}

// Off-screen and transparent rather than visibility:hidden — the search box
// must stay focusable during the measuring pass.
const HIDDEN_POPOVER: CSSProperties = { position: "fixed", top: 0, left: -10000, opacity: 0, pointerEvents: "none" };

/**
 * Fixed-position placement under (or over) an anchor. The direction is picked
 * from the popover's natural height at open, so filtering a long list does not
 * make it jump from below the trigger to above it mid-typing.
 */
export function usePopoverPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  popoverRef: RefObject<HTMLElement | null>
) {
  const [style, setStyle] = useState<CSSProperties>(HIDDEN_POPOVER);
  const naturalHeight = useRef(0);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const gap = 4;
    const margin = 8;
    const below = viewportH - rect.bottom - gap - margin;
    const above = rect.top - gap - margin;
    const upward = naturalHeight.current > below && above > below;
    const width = Math.min(Math.max(rect.width, 220), viewportW - margin * 2);
    const left = Math.max(margin, Math.min(rect.left, viewportW - width - margin));
    setStyle({
      position: "fixed",
      left,
      width,
      top: upward ? undefined : rect.bottom + gap,
      bottom: upward ? viewportH - rect.top + gap : undefined,
      maxHeight: Math.max(140, upward ? above : below)
    });
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) {
      setStyle(HIDDEN_POPOVER);
      return;
    }
    // First pass renders off-screen and unconstrained, so this is its real height.
    naturalHeight.current = popoverRef.current?.offsetHeight ?? 0;
    place();
    function onScroll(event: Event) {
      // Scrolling the list itself must not re-place it on every wheel tick.
      if (popoverRef.current && event.target instanceof Node && popoverRef.current.contains(event.target)) return;
      place();
    }
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, place, popoverRef]);

  return style;
}

/** Closes a popover on a press anywhere outside the given elements. */
export function useOutsidePress(open: boolean, refs: Array<RefObject<HTMLElement | null>>, onOutside: () => void) {
  const handler = useRef(onOutside);
  useLayoutEffect(() => { handler.current = onOutside; });
  useEffect(() => {
    if (!open) return;
    function onDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && refs.some((ref) => ref.current?.contains(target))) return;
      handler.current();
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
    // refs are stable ref objects created by the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

/** Renders options with group headings; `active` indexes into `options`. */
export function OptionRows({
  options,
  active,
  idPrefix,
  isSelected,
  onPick,
  onHover,
  renderMark
}: {
  options: SelectOption[];
  active: number;
  idPrefix: string;
  isSelected: (option: SelectOption) => boolean;
  onPick: (option: SelectOption) => void;
  onHover: (index: number) => void;
  renderMark?: (selected: boolean) => ReactNode;
}) {
  const rows: ReactNode[] = [];
  let lastGroup: string | undefined;
  options.forEach((option, index) => {
    if (option.group && option.group !== lastGroup) {
      rows.push(<div className="sel-group" role="presentation" key={`g-${index}-${option.group}`}>{option.group}</div>);
    }
    lastGroup = option.group;
    const selected = isSelected(option);
    rows.push(
      <div
        key={`o-${index}-${option.value}`}
        id={`${idPrefix}-opt-${index}`}
        role="option"
        aria-selected={selected}
        aria-disabled={option.disabled || undefined}
        data-index={index}
        className={`sel-option${index === active ? " active" : ""}${selected ? " selected" : ""}${option.value === "" ? " is-empty" : ""}`}
        // Keep focus where it is (trigger / search box) while clicking.
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => { if (index !== active) onHover(index); }}
        onClick={() => { if (!option.disabled) onPick(option); }}
      >
        {renderMark ? renderMark(selected) : null}
        <span className="sel-option-label">{option.label}</span>
        {!renderMark && selected ? <Check size={15} aria-hidden="true" /> : null}
      </div>
    );
  });
  return <>{rows}</>;
}

export type SelectProps = {
  options: SelectOption[];
  /** Controlled value. Leave undefined and use `defaultValue` for uncontrolled. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** When set, a hidden input with this name carries the value into FormData. */
  name?: string;
  /** Shown when no option matches the value. */
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Defaults to on when there are more than SEARCH_THRESHOLD options. */
  searchable?: boolean;
  size?: "sm" | "md";
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
};

export function Select({
  options,
  value,
  defaultValue = "",
  onChange,
  name,
  placeholder = "Select…",
  disabled = false,
  invalid = false,
  searchable,
  size = "md",
  id,
  className,
  ...aria
}: SelectProps) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const current = controlled ? value : inner;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const autoId = useId();
  const listId = `${autoId}-list`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ text: "", at: 0 });

  const showSearch = searchable ?? options.length > SEARCH_THRESHOLD;
  const filtered = useMemo(
    () => (showSearch && query.trim() ? options.filter((option) => matchesQuery(option, query)) : options),
    [options, query, showSearch]
  );
  const selected = options.find((option) => option.value === current);
  const style = usePopoverPosition(open, triggerRef, popoverRef);

  function openMenu() {
    if (disabled) return;
    setQuery("");
    const index = options.findIndex((option) => option.value === current && !option.disabled);
    setActive(index >= 0 ? index : firstEnabled(options));
    setOpen(true);
  }

  function close(returnFocus = true) {
    setOpen(false);
    setQuery("");
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
  }

  function pick(option: SelectOption) {
    if (option.disabled) return;
    if (!controlled) setInner(option.value);
    if (option.value !== current) onChange?.(option.value);
    close();
  }

  useOutsidePress(open, [triggerRef, popoverRef], () => close(false));

  useEffect(() => {
    if (!open) return;
    (showSearch ? searchRef.current : listRef.current)?.focus({ preventScroll: true });
  }, [open, showSearch]);

  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function onTriggerKey(event: KeyboardEvent<HTMLButtonElement>) {
    // Enter and Space already click the button, which toggles.
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openMenu();
    }
  }

  function onPopoverKey(event: KeyboardEvent<HTMLDivElement>) {
    const inSearch = event.target === searchRef.current;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((index) => (index < 0 ? firstEnabled(filtered) : nextEnabled(filtered, index, 1)));
        return;
      case "ArrowUp":
        event.preventDefault();
        setActive((index) => (index < 0 ? firstEnabled(filtered) : nextEnabled(filtered, index, -1)));
        return;
      case "Home":
        if (inSearch) return;
        event.preventDefault();
        setActive(firstEnabled(filtered));
        return;
      case "End":
        if (inSearch) return;
        event.preventDefault();
        setActive(nextEnabled(filtered, filtered.length, -1));
        return;
      case "Enter":
        event.preventDefault();
        if (filtered[active]) pick(filtered[active]);
        return;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      case "Tab":
        event.preventDefault();
        close();
        return;
      default:
        break;
    }
    // Without a search box, typing jumps to the next option starting with it.
    if (!inSearch && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      const buffer = now - typeahead.current.at < 600 ? typeahead.current.text + event.key : event.key;
      typeahead.current = { text: buffer, at: now };
      const needle = fold(buffer);
      const start = buffer.length > 1 ? active : active + 1;
      for (let offset = 0; offset < filtered.length; offset += 1) {
        const index = (Math.max(0, start) + offset) % filtered.length;
        if (!filtered[index].disabled && fold(filtered[index].label).startsWith(needle)) {
          setActive(index);
          break;
        }
      }
    }
  }

  const activeId = open && active >= 0 && filtered[active] ? `${autoId}-opt-${active}` : undefined;

  return (
    <div className={`sel${size === "sm" ? " sel-sm" : ""}${className ? ` ${className}` : ""}`}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        className={`sel-trigger${open ? " open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-invalid={invalid || undefined}
        aria-label={aria["aria-label"]}
        aria-labelledby={aria["aria-labelledby"]}
        aria-describedby={aria["aria-describedby"]}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKey}
      >
        <span className={`sel-value${selected ? "" : " placeholder"}`}>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={size === "sm" ? 14 : 16} className="sel-chevron" aria-hidden="true" />
      </button>
      {/* Disabled controls do not submit, same as a native select. */}
      {name && !disabled ? <input type="hidden" name={name} value={current} /> : null}
      {open
        ? createPortal(
            <div ref={popoverRef} className="sel-pop" style={style} onKeyDown={onPopoverKey}>
              {showSearch ? (
                <div className="sel-search">
                  <Search size={14} aria-hidden="true" />
                  <input
                    ref={searchRef}
                    type="text"
                    value={query}
                    placeholder="Type to search…"
                    aria-label="Search options"
                    aria-controls={listId}
                    aria-activedescendant={activeId}
                    aria-autocomplete="list"
                    onChange={(event) => {
                      setQuery(event.target.value);
                      const next = options.filter((option) => matchesQuery(option, event.target.value));
                      setActive(firstEnabled(next));
                    }}
                  />
                </div>
              ) : null}
              <div
                ref={listRef}
                id={listId}
                role="listbox"
                tabIndex={-1}
                className="sel-list"
                aria-label={aria["aria-label"]}
                aria-labelledby={aria["aria-labelledby"]}
                aria-activedescendant={showSearch ? undefined : activeId}
              >
                <OptionRows
                  options={filtered}
                  active={active}
                  idPrefix={autoId}
                  isSelected={(option) => option.value === current}
                  onPick={pick}
                  onHover={setActive}
                />
                {filtered.length === 0 ? <div className="sel-empty">{query ? `No match for “${query}”` : "No options"}</div> : null}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
