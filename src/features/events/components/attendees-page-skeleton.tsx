import { Page } from "#/components/layout/page";
import { Skeleton } from "#/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";

const SKELETON_ROWS = [0, 1, 2, 3, 4, 5, 6, 7];

/**
 * The attendees page's loading shape: back link, heading, the search and type-filter controls,
 * and the four-column results table — so a navigation from the workspace shows the page it is
 * about to become.
 */
export function AttendeesPageSkeleton() {
  return (
    <Page width="wide" aria-busy="true">
      <output className="sr-only">Loading attendees…</output>

      <Skeleton className="h-4 w-36" />
      <Skeleton className="mt-6 h-10 w-56" />
      <Skeleton className="mt-3 h-4 w-44" />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 w-full max-w-xs" />
        <Skeleton className="h-8 w-40" />
      </div>

      <div className="mt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Skeleton className="h-3 w-16" />
              </TableHead>
              <TableHead>
                <Skeleton className="h-3 w-16" />
              </TableHead>
              <TableHead>
                <Skeleton className="h-3 w-16" />
              </TableHead>
              <TableHead>
                <Skeleton className="h-3 w-24" />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {SKELETON_ROWS.map(row => (
              <TableRow key={row}>
                <TableCell>
                  <Skeleton className="h-4 w-32" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-48" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-16" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-32" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Page>
  );
}
