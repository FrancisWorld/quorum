import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

export interface TabSpec {
  id: string;
  label: string;
  badge?: number;
  panel: ReactNode;
}

/** WAI-ARIA tabs: roving tabindex, arrow/Home/End navigation. */
export function Tabs({ tabs, active, onChange }: { tabs: TabSpec[]; active: string; onChange: (id: string) => void }) {
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.id === active);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    const target = tabs[next];
    if (target) {
      onChange(target.id);
      refs.current[target.id]?.focus();
    }
  };

  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  return (
    <div>
      {/* Key events bubble up from the focusable tabs; the container itself is not a tab stop. */}
      {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus */}
      <div role="tablist" className="tabs" onKeyDown={onKeyDown} aria-label="Room sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            ref={(node) => {
              refs.current[tab.id] = node;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${tab.id}`}
            aria-selected={tab.id === current?.id}
            aria-controls={`${base}-panel-${tab.id}`}
            tabIndex={tab.id === current?.id ? 0 : -1}
            className="tab"
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
            {tab.badge ? <span className="badge">{tab.badge}</span> : null}
          </button>
        ))}
      </div>
      {current && (
        <div role="tabpanel" id={`${base}-panel-${current.id}`} aria-labelledby={`${base}-tab-${current.id}`} tabIndex={0}>
          {current.panel}
        </div>
      )}
    </div>
  );
}
