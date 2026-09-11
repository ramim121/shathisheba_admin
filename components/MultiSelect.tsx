"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, X } from "lucide-react";
import { OptionRows, matchesQuery, useOutsidePress, usePopoverPosition, type SelectOption } from "@/components/Select";

/**
 * Pick several records by name — chips in the box, a filterable list below.
 *
 * The value travels as one comma-separated id string ("1,2") in a hidden
 * input, which is the shape the API stores and returns for these columns.
 */

export function splitIds(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

type MultiSelectProps = {
  options: SelectOption[];
  value: string[];
  onChange?: (values: string[]) => void;
  /** When set, a hidden input carries the comma-joined ids into FormData. */
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
};

export function MultiSelect({
  options,
  value,
  onChange,
  name,
  placeholder = "Search and pick…",
  disabled = false,
  invalid = false,
  id,
  ...aria
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const autoId = useId();
  const listId = `${autoId}-list`;
  const controlRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const chosen = useMemo(() => new Set(value), [value]);
  const filtered = useMemo(() => options.filter((option) => matchesQuery(option, query)), [options, query]);
  const labelOf = useMemo(() => new Map(options.map((option) => [option.value, option.label])), [options]);
  const style = usePopoverPosition(open, controlRef, popoverRef);

  useOutsidePress(open, [controlRef, popoverRef], () => setOpen(false));

  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function toggle(option: SelectOption) {
    if (option.disabled) return;
    const next = chosen.has(option.value) ? value.filter((item) => item !== option.value) : [...value, option.value];
    onChange?.(next);
  }

  function remove(item: string) {
    onChange?.(value.filter((entry) => entry !== item));
    inputRef.current?.focus();
  }

  function openList() {
    if (disabled || open) return;
    setActive(filtered.findIndex((option) => !option.disabled));
    setOpen(true);
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (!open) { openList(); return; }
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((index) => {
          let next = index;
          for (let tries = 0; tries < filtered.length; tries += 1) {
            next += step;
            if (next < 0 || next >= filtered.length) return index;
            if (!filtered[next].disabled) return next;
          }
          return index;
        });
        return;
      }
      case "Enter":
        // Never let Enter here submit the surrounding form.
        event.preventDefault();
        if (open && filtered[active]) toggle(filtered[active]);
        else openList();
        return;
      case "Escape":
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
        return;
      case "Backspace":
        if (!query && value.length) remove(value[value.length - 1]);
        return;
      case "Tab":
        setOpen(false);
        return;
      default:
    }
  }

  const activeId = open && active >= 0 && filtered[active] ? `${autoId}-opt-${active}` : undefined;

  return (
    <div className="msel">
      <div
        ref={controlRef}
        className={`msel-control${focused || open ? " focused" : ""}${disabled ? " disabled" : ""}`}
        aria-invalid={invalid || undefined}
        onMouseDown={(event) => {
          // A chip's remove button handles itself; anywhere else in the box
          // focuses the search and opens the list.
          if (disabled || (event.target as HTMLElement).closest("button")) return;
          if (event.target !== inputRef.current) {
            event.preventDefault();
            inputRef.current?.focus();
          }
          openList();
        }}
      >
        {value.map((item) => (
          <span className="msel-chip" key={item}>
            <span title={labelOf.get(item) ?? `id ${item}`}>{labelOf.get(item) ?? `id ${item} (not in list)`}</span>
            {disabled ? null : (
              <button type="button" aria-label={`Remove ${labelOf.get(item) ?? item}`} onClick={() => remove(item)}>
                <X size={12} />
              </button>
            )}
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          className="msel-input"
          type="text"
          role="combobox"
          value={query}
          disabled={disabled}
          placeholder={value.length ? "" : placeholder}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-invalid={invalid || undefined}
          aria-labelledby={aria["aria-labelledby"]}
          aria-describedby={aria["aria-describedby"]}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            setQuery(event.target.value);
            const next = options.filter((option) => matchesQuery(option, event.target.value));
            setActive(next.findIndex((option) => !option.disabled));
            if (!open) setOpen(true);
          }}
          onKeyDown={onKey}
        />
        <ChevronDown size={16} className="msel-chevron" aria-hidden="true" />
      </div>
      {name && !disabled ? <input type="hidden" name={name} value={value.join(",")} /> : null}
      {open
        ? createPortal(
            <div ref={popoverRef} className="sel-pop" style={style}>
              <div ref={listRef} id={listId} role="listbox" aria-multiselectable="true" className="sel-list" aria-labelledby={aria["aria-labelledby"]}>
                <OptionRows
                  options={filtered}
                  active={active}
                  idPrefix={autoId}
                  isSelected={(option) => chosen.has(option.value)}
                  onPick={toggle}
                  onHover={setActive}
                  renderMark={(selected) => (
                    <span className={`msel-box${selected ? " on" : ""}`} aria-hidden="true">{selected ? <Check size={11} strokeWidth={3} /> : null}</span>
                  )}
                />
                {filtered.length === 0 ? <div className="sel-empty">{query ? `No match for “${query}”` : "No options"}</div> : null}
              </div>
              {value.length ? (
                <div className="msel-foot">
                  <span>{value.length} selected</span>
                  <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onChange?.([])}>Clear all</button>
                </div>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
