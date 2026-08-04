/**
 * Which operator action produced the stored Amazee.ai credentials.
 *
 * Port of `Tag1\Scolta\AiProvider\Amazee\AmazeeConnectionSource`. Recorded at
 * the moment a connection is established, never derived afterwards. The
 * distinction was previously guessed from whatever local fact an adapter had to
 * hand, which is why it was removed outright: the trial provisioner and the
 * account upgrader persist the same three fields through
 * {@link ConfigStorage.store}, so nothing in the credential store could tell
 * them apart. Recording the fact at its source is what makes the distinction
 * reportable again.
 *
 * Neither case implies anything automatic. Both are reached only by an explicit
 * operator action in an admin UI, or by a developer who set `ai_provider` to
 * `amazee` in code and then ran the provisioning path.
 */
export const AmazeeConnectionSource = {
  /**
   * The operator started the free demo, which needs no email and no account.
   *
   * One-time per site: the credit it ships with is not renewed. When it runs
   * out the operator continues by signing in to an account.
   */
  Demo: "demo",

  /**
   * The operator signed in to an amazee.ai account with their email address.
   *
   * The email → verification code → region flow creates or attaches the account
   * and returns its credentials, which are then persisted. Same flow whether
   * the account is new or already existed, matching amazee.ai's own
   * `ai_provider_amazeeio` module.
   */
  Account: "account",
} as const;

export type AmazeeConnectionSource = (typeof AmazeeConnectionSource)[keyof typeof AmazeeConnectionSource];

/**
 * A short operator-facing name for a connection, in English.
 *
 * No label describes a connection as automatic or as provisioned on the
 * operator's behalf, because neither is.
 */
export function amazeeConnectionSourceLabel(source: AmazeeConnectionSource): string {
  return source === AmazeeConnectionSource.Demo ? "Amazee.ai demo" : "Amazee.ai account";
}
