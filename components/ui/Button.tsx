import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "decision" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  trailing?: ReactNode;
  loading?: boolean;
};

/** Generic button. `decision` is reserved for actions that call or act on the OpenAI Decisions API. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, trailing, loading, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={["ui-btn", `ui-btn--${variant}`, `ui-btn--${size}`, loading ? "is-loading" : "", className ?? ""].join(" ").trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {icon ? <span className="ui-btn__icon" aria-hidden>{icon}</span> : null}
      {children ? <span className="ui-btn__label">{children}</span> : null}
      {trailing ? <span className="ui-btn__trail" aria-hidden>{trailing}</span> : null}
    </button>
  );
});
