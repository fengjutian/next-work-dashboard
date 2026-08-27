/**
 * Minimal shadcn-style Button. Mirrors the shape used by prompt-lab's
 * `@/components/ui/button` (variant + size). Hosts can override by
 * supplying their own via Tailwind config or by re-exporting a richer
 * component.
 */

import React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "default", size = "default", ...props }, ref) => (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 ${variant === "default" ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}${variant === "destructive" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}${variant === "outline" ? "border border-input bg-background hover:bg-accent hover:text-accent-foreground" : ""}${variant === "secondary" ? "bg-secondary text-secondary-foreground hover:bg-secondary/80" : ""}${variant === "ghost" ? "hover:bg-accent hover:text-accent-foreground" : ""}${variant === "link" ? "text-primary underline-offset-4 hover:underline" : ""} ${size === "default" ? "h-9 px-4 py-2" : ""}${size === "sm" ? "h-8 px-3 text-xs" : ""}${size === "lg" ? "h-10 px-6" : ""}${size === "icon" ? "h-9 w-9" : ""} ${className}`.trim()}
      {...props}
    />
  ),
);
Button.displayName = "Button";
