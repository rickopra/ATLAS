export type RpcArgs = unknown[];

async function fetchJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    credentials: 'include',
    ...init
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((payload as { message?: string }).message || `Request failed with status ${response.status}`);
  }

  return payload as T;
}

export async function rpcCall<T>(method: string, ...args: RpcArgs) {
  return fetchJson<T>(`/api/rpc/${encodeURIComponent(method)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ args })
  });
}

export async function fetchPageJson<T>(url: string, init?: RequestInit) {
  return fetchJson<T>(url, init);
}
