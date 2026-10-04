import {
  useId,
  type ReactNode,
  type ReactElement,
  type ButtonHTMLAttributes,
} from "react";
import { Button as BaseButton } from "@base-ui/react/button";
import { cva } from "class-variance-authority";
import { cn } from "./utils.js";

const buttonStyles = cva("ui-button", {
  variants: {
    variant: {
      default: "button-default",
      primary: "button-primary",
      destructive: "button-destructive",
      ghost: "button-ghost",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Button({
  className,
  variant,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "destructive" | "ghost";
}): ReactElement {
  return (
    <BaseButton
      type="button"
      className={cn(buttonStyles({ variant }), className)}
      {...props}
    />
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="builder-field">
      <label>
        <span>{label}</span>
        {children}
      </label>
      {hint && <small>{hint}</small>}
    </div>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}): ReactElement {
  return (
    <p
      className={error ? "builder-notice error" : "builder-notice"}
      role={error ? "alert" : "status"}
    >
      {children}
    </p>
  );
}
export function Tabs({
  tabs,
  selected,
  onSelect,
  children,
}: {
  tabs: readonly string[];
  selected: string;
  onSelect: (tab: string) => void;
  children: ReactNode;
}): ReactElement {
  const id = useId();
  return (
    <div>
      <div
        role="tablist"
        aria-label="Test configuration"
        className="builder-tabs"
      >
        {tabs.map((tab, index) => (
          <Button
            key={tab}
            role="tab"
            id={`${id}-tab-${index}`}
            aria-selected={selected === tab}
            aria-controls={`${id}-panel`}
            tabIndex={selected === tab ? 0 : -1}
            onClick={() => onSelect(tab)}
            onKeyDown={(event) => {
              let next: number | undefined;
              if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
              if (event.key === "ArrowLeft")
                next = (index + tabs.length - 1) % tabs.length;
              if (event.key === "Home") next = 0;
              if (event.key === "End") next = tabs.length - 1;
              if (next !== undefined) {
                event.preventDefault();
                onSelect(tabs[next]!);
                const buttons =
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                    '[role="tab"]',
                  );
                buttons?.[next]?.focus();
              }
            }}
          >
            {tab}
          </Button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${tabs.indexOf(selected)}`}
        tabIndex={0}
        className="builder-tab-panel"
      >
        {children}
      </div>
    </div>
  );
}
