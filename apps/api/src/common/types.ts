import type { DataScope, Permission, Role, UserType } from '@sihl-one/contracts';

/** The authenticated caller, resolved from the access token on every request. */
export interface AuthenticatedPrincipal {
  id: string;
  email: string;
  fullName: string;
  userType: UserType;
  roles: Role[];
  permissions: Permission[];
  dataScope: DataScope;
  orgUnitId: string | null;
  /** Materialised path of the caller's org unit; used for subtree ABAC. */
  orgUnitPath: string | null;
  /** Ids of users reporting to this user, for the TEAM scope. */
  teamUserIds: string[];
  partnerId: string | null;
  sessionId: string;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function paginate<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResult<T> {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
  };
}
