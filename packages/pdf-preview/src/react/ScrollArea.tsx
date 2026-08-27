/**
 * Minimal Radix-based ScrollArea. Mirrors the shape used by
 * prompt-lab's `@/components/ui/scroll-area` so the package can render
 * PDF pages inside a styled scroll viewport without taking on the
 * full shadcn `cn` helper.
 *
 * The default Radix scrollbar colors use `bg-foreground/20` which
 * expects the host to provide Tailwind's foreground/background CSS
 * variables. We re-declare the bar's own colors inline so the panel
 * renders correctly even if a host's Tailwind config doesn't include
 * the package's content globs.
 */

import React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";

const ROOT_CLASS = "pdf-scroll-root";
const VIEWPORT_CLASS = "pdf-scroll-viewport";
const SCROLLBAR_CLASS = "pdf-scroll-scrollbar";
const SCROLLBAR_VERTICAL_CLASS = "pdf-scroll-scrollbar--v";
const SCROLLBAR_HORIZONTAL_CLASS = "pdf-scroll-scrollbar--h";
const THUMB_CLASS = "pdf-scroll-thumb";
const CORNER_CLASS = "pdf-scroll-corner";

const ROOT_STYLE: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
};

const VIEWPORT_STYLE: React.CSSProperties = {
  height: "100%",
  width: "100%",
  borderRadius: "inherit",
};

const SCROLLBAR_BASE_STYLE: React.CSSProperties = {
  display: "flex",
  touchAction: "none",
  userSelect: "none",
  transition: "all 200ms",
  padding: "1px",
  background: "transparent",
};

const SCROLLBAR_VERTICAL_STYLE: React.CSSProperties = {
  ...SCROLLBAR_BASE_STYLE,
  width: 6,
  height: "100%",
};

const SCROLLBAR_HORIZONTAL_STYLE: React.CSSProperties = {
  ...SCROLLBAR_BASE_STYLE,
  height: 6,
  width: "100%",
  flexDirection: "column",
};

const THUMB_BASE_STYLE: React.CSSProperties = {
  position: "relative",
  flex: 1,
  borderRadius: 9999,
  background: "hsl(var(--foreground) / 0.2)",
  transition: "background-color 150ms",
};

function mergeStyle(...styles: (React.CSSProperties | undefined)[]): React.CSSProperties {
  return Object.assign({}, ...styles.filter((s): s is React.CSSProperties => Boolean(s)));
}

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", style, ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={[
      SCROLLBAR_CLASS,
      orientation === "vertical" ? SCROLLBAR_VERTICAL_CLASS : SCROLLBAR_HORIZONTAL_CLASS,
      className ?? "",
    ].join(" ")}
    style={mergeStyle(
      orientation === "vertical" ? SCROLLBAR_VERTICAL_STYLE : SCROLLBAR_HORIZONTAL_STYLE,
      style,
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb
      className={THUMB_CLASS}
      style={THUMB_BASE_STYLE}
    />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
));
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;

export interface ScrollAreaProps extends React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> {}

export const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  ScrollAreaProps
>(({ className, children, style, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    className={[ROOT_CLASS, className ?? ""].join(" ")}
    style={mergeStyle(ROOT_STYLE, style)}
    {...props}
  >
    <ScrollAreaPrimitive.Viewport
      className={VIEWPORT_CLASS}
      style={VIEWPORT_STYLE}
    >
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollBar orientation="horizontal" />
    <ScrollAreaPrimitive.Corner className={CORNER_CLASS} />
  </ScrollAreaPrimitive.Root>
));
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;
