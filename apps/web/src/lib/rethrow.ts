import { unstable_rethrow } from 'next/navigation';

/**
 * Let Next's own control-flow errors out of a catch block.
 *
 * `redirect()` and `notFound()` work by throwing. A server action that wraps
 * its work in `try { … } catch (error) { return { status: 'error', … } }` —
 * which is every action in this app — catches those throws along with real
 * failures and turns them into an error message on the form.
 *
 * That is how a session expiring mid-edit became "The lead could not be saved."
 * `apiFetch` calls `redirect('/login?reason=expired')` on a 401; the catch
 * swallowed it, so the redirect never happened, the login page never said
 * "Your session expired" — a message it has always had and nobody had seen —
 * and the user retyped the form into a session that was already gone.
 *
 * Call this first in any catch that returns rather than rethrows. It re-throws
 * the control-flow errors and returns quietly for everything else, so the line
 * after it still handles genuine failures.
 */
export function rethrowControlFlow(error: unknown): void {
  unstable_rethrow(error);
}
