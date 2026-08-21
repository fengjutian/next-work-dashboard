import React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "default", size = "default", asChild: _asChild, ...props }, ref) => (
    <button
      ref={ref}
      className={`osc-button osc-button--${variant} osc-button--${size} ${className}`.trim()}
      {...props}
    />
  ),
);
Button.displayName = "Button";
