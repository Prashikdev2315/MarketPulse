export function Skeleton({ className = '', style = {} }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} />;
}

export function IndexCardSkeleton() {
  return (
    <div className="glass rounded-xl p-4 space-y-3" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex justify-between items-start">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3 w-14" />
        </div>
        <Skeleton className="h-7 w-16 rounded" />
      </div>
      <Skeleton className="h-7 w-28" />
      <Skeleton className="h-1 w-full rounded-full" />
      <div className="flex gap-4">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="glass rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-8 w-48 rounded-lg" />
      </div>
      <div className="p-4 space-y-2">
        <Skeleton style={{ height: 480 }} className="w-full rounded" />
      </div>
    </div>
  );
}

export function NewsSkeleton() {
  return (
    <div className="divide-y divide-white/[0.04]">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="px-5 py-4 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-20 rounded-full" />
            <Skeleton className="h-3 w-12 rounded-full" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}

export function AIAnalysisSkeleton() {
  return (
    <div className="p-5 space-y-4">
      <Skeleton className="h-5 w-3/4" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-12 rounded-lg" />
        <Skeleton className="h-12 rounded-lg" />
        <Skeleton className="h-12 rounded-lg" />
        <Skeleton className="h-12 rounded-lg" />
      </div>
    </div>
  );
}

export function StockSearchResultsSkeleton() {
  return (
    <div className="p-2 space-y-1">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="h-8 w-8 rounded-lg flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-2.5 w-20" />
          </div>
          <Skeleton className="h-5 w-12 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function TrendingSkeleton() {
  return (
    <div className="flex gap-2 overflow-hidden">
      {[...Array(6)].map((_, i) => (
        <Skeleton key={i} className="h-9 w-28 rounded-full flex-shrink-0" />
      ))}
    </div>
  );
}

export function StockModalSkeleton() {
  return (
    <div className="space-y-4 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
        <div className="text-right space-y-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      {/* 52W bar */}
      <Skeleton className="h-1.5 w-full rounded-full" />
      {/* Fundamentals grid */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
      </div>
      {/* Chart area */}
      <Skeleton style={{ height: 400 }} className="w-full rounded-lg" />
    </div>
  );
}
