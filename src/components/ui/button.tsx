import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "orbit-button inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[#6749d3] text-white shadow-sm hover:bg-[#573abd]",
        outline: "border border-[#e6e4ed] bg-white text-[#3d374a] hover:bg-[#f7f5fc]",
        ghost: "text-[#60596f] hover:bg-[#f3f0fa]",
        danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50",
      },
      size: { default: "min-h-10 px-4 [&_svg]:size-5", sm: "min-h-9 px-3 text-[13px]", icon: "size-10 [&_svg]:size-5" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className, variant, size, asChild = false, type = "button", ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : "button";
  return <Component className={cn(buttonVariants({ variant, size }), className)} data-tooltip={size === "icon" ? props["aria-label"] : undefined}
    {...(!asChild && { type })} {...props} />;
}
