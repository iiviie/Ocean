import * as RSlider from "@radix-ui/react-slider";
import { cn } from "@/ui/lib/cn";

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  className?: string;
}

// shadcn/ui-style slider over the Radix primitive — generous hit area, tokened.
export function Slider({ value, min, max, step = 0.01, onChange, className }: SliderProps) {
  return (
    <RSlider.Root
      className={cn("relative flex h-5 w-full touch-none select-none items-center", className)}
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={([v]) => onChange(v)}
    >
      <RSlider.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-secondary">
        <RSlider.Range className="absolute h-full rounded-full bg-primary" />
      </RSlider.Track>
      <RSlider.Thumb
        className="block size-3.5 rounded-full border border-primary bg-foreground shadow-sm transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label="value"
      />
    </RSlider.Root>
  );
}
