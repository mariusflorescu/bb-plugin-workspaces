import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function LoadError({
  message,
  retry,
  className,
}: {
  readonly message: string;
  readonly retry: () => void;
  readonly className?: string;
}) {
  return (
    <div role="alert" className={cn("flex items-center justify-between gap-3 text-sm", className)}>
      <span className="text-destructive">{message}</span>
      <Button type="button" variant="outline" size="sm" onClick={retry}>
        Retry
      </Button>
    </div>
  );
}
