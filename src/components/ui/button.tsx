import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[#6749d3] text-white shadow-sm hover:bg-[#573abd]",
        outline: "border border-[#e6e4ed] bg-white text-[#3d374a] hover:bg-[#f7f5fc]",
        ghost: "text-[#60596f] hover:bg-[#f3f0fa]",
        danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50",
      },
      size: { default: "h-10 px-4", sm: "h-8 px-3 text-xs", icon: "size-9" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className, variant, size, asChild = false, type = "button", ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : "button";
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...(!asChild && { type })} {...props} />;
}
