import { cn } from '../../utils/cn.js';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}

/** Full-page loading state used while bootstrapping the session. */
export function PageSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-bg">
      <div className="w-full max-w-md space-y-4 p-8">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}
