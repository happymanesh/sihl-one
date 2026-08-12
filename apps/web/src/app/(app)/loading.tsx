/**
 * Skeleton rather than a spinner.
 *
 * A spinner says "wait"; a skeleton says "here is the shape of what is coming",
 * which measurably reduces perceived latency and stops the layout jumping when
 * the real content lands.
 */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy role="status" aria-label="Loading">
      <div className="space-y-2">
        <div className="skeleton h-7 w-56" />
        <div className="skeleton h-4 w-80" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="card p-4">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton mt-3 h-7 w-20" />
            <div className="skeleton mt-2 h-3 w-32" />
          </div>
        ))}
      </div>

      <div className="card p-5">
        <div className="skeleton h-5 w-44" />
        <div className="skeleton mt-4 h-56 w-full" />
      </div>
    </div>
  );
}
