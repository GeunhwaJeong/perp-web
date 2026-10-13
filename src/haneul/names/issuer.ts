import { NAME_ISSUER_URL } from './config';

export class NameIssuerUnavailableError extends Error {
  constructor(message = 'Name issuing is not available right now') {
    super(message);
    this.name = 'NameIssuerUnavailableError';
  }
}

export type NameIssueResult = {
  /** Digest of the transaction that registered the name and sent it to the address. */
  digest: string;
};

/**
 * Asks the issuer to write `name.haneul` for `address`. The issuer holds the operator key,
 * applies the free-name rules (one per address, length, deny list) and pays the gas; the
 * page only ever sends the pair. When no issuer is configured the name stays pending on
 * the device and the UI says so.
 */
export const requestNameIssue = async ({
  name,
  address,
}: {
  name: string;
  address: string;
}): Promise<NameIssueResult> => {
  if (!NAME_ISSUER_URL) throw new NameIssuerUnavailableError();

  let response: Response;
  try {
    response = await fetch(`${NAME_ISSUER_URL.replace(/\/$/, '')}/names`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, address }),
    });
  } catch {
    throw new NameIssuerUnavailableError();
  }

  if (!response.ok) {
    let message = `Name issuing failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the status message
    }
    throw new NameIssuerUnavailableError(message);
  }

  return (await response.json()) as NameIssueResult;
};
