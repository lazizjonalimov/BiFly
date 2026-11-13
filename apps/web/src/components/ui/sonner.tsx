"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

/** Brief confirmations and failures. Styled from the theme tokens so it follows light and dark. */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      closeButton
      toastOptions={{ classNames: { toast: "!bg-popover !text-popover-foreground !border-border !shadow-lg", description: "!text-muted-foreground" } }}
      {...props}
    />
  );
}

export { Toaster };
