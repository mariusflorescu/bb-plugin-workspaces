import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function SkeletonRows({
  label,
  rowClassName,
  className,
}: {
  readonly label: string;
  readonly rowClassName: string;
  readonly className?: string;
}) {
  return (
    <div role="status" aria-label={label} className={cn("flex flex-col gap-2", className)}>
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className={rowClassName} />
      ))}
    </div>
  );
}
